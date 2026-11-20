# agentbox Plane bootstrap. Piped into `python manage.py shell` inside the api container.
# Idempotent. The config (including the admin password) arrives base64-encoded in this script's
# text via stdin, never as a command-line argument or environment variable.
import base64
import json
import uuid

from django.contrib.auth.hashers import make_password
from django.db import transaction
from plane.db.models import APIToken, Profile, Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin, InstanceConfiguration

cfg = json.loads(base64.b64decode("__AGENTBOX_CONFIG__").decode())
out = {"phase": cfg["phase"]}

ONBOARDED = {"profile_complete": True, "workspace_create": True, "workspace_invite": True, "workspace_join": True}


def ensure_user(email, first_name, last_name, display_name, password, is_bot):
    user = User.objects.filter(email=email).first()
    created = user is None
    if created:
        user = User.objects.create(
            email=email,
            username=uuid.uuid4().hex,
            first_name=first_name,
            last_name=last_name,
            display_name=display_name,
            password=make_password(password),  # None -> unusable password (bot)
            is_password_autoset=password is None,
            is_active=True,
            is_bot=is_bot,
        )
    return user, created


def onboard(user, workspace):
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.is_onboarded = True
    profile.is_tour_completed = True
    profile.onboarding_step = ONBOARDED
    profile.last_workspace_id = workspace.id
    profile.save()


if cfg["phase"] == "users":
    with transaction.atomic():
        instance = Instance.objects.first()
        if instance is None:
            raise SystemExit("AGENTBOX_ERROR=instance not registered yet, retry after the api is up")
        a = cfg["admin"]
        existing_admin = User.objects.filter(email=a["email"]).first()
        if existing_admin is None and InstanceAdmin.objects.exists():
            raise SystemExit("AGENTBOX_ERROR=another instance admin already exists")
        admin, out["admin_created"] = ensure_user(a["email"], a["first_name"], a["last_name"], a["display_name"], a["password"], False)
        InstanceAdmin.objects.get_or_create(user=admin, instance=instance, defaults={"role": 20})
        instance.is_setup_done = True
        instance.is_signup_screen_visited = True
        instance.is_telemetry_enabled = False
        instance.instance_name = cfg["instance_name"]
        instance.save()
        InstanceConfiguration.objects.update_or_create(
            key="ENABLE_SIGNUP", defaults={"value": "0", "category": "AUTHENTICATION", "is_encrypted": False}
        )

        w = cfg["workspace"]
        workspace = Workspace.objects.filter(slug=w["slug"]).first()
        out["workspace_created"] = workspace is None
        if workspace is None:
            workspace = Workspace.objects.create(name=w["name"], slug=w["slug"], owner=admin)
        WorkspaceMember.objects.get_or_create(workspace=workspace, member=admin, defaults={"role": 20})

        b = cfg["bot"]
        bot, out["bot_created"] = ensure_user(b["email"], b["display_name"], "", b["display_name"], None, True)
        WorkspaceMember.objects.get_or_create(workspace=workspace, member=bot, defaults={"role": 20})
        onboard(admin, workspace)
        onboard(bot, workspace)

        token = APIToken.objects.filter(user=bot, label="agentbox-automation", is_active=True).first()
        if token is None:
            token = APIToken.objects.create(user=bot, label="agentbox-automation", description="agentbox automation and MCP")
        out.update({"workspace_id": str(workspace.id), "bot_id": str(bot.id), "admin_id": str(admin.id), "token": token.token})

elif cfg["phase"] == "membership":
    project = Project.objects.get(workspace__slug=cfg["workspace_slug"], identifier=cfg["project_identifier"])
    for email in cfg["emails"]:
        user = User.objects.get(email=email)
        member, created = ProjectMember.objects.get_or_create(
            project=project, member=user, defaults={"role": 20, "workspace": project.workspace}
        )
        if not member.is_active:
            member.is_active = True
            member.save()
    out["project_id"] = str(project.id)

print("AGENTBOX_RESULT=" + json.dumps(out))
