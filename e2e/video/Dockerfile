# A clean Ubuntu 24.04 "VM" for recordings and local install tests: systemd as PID 1, sudo, curl,
# ssh and an `ubuntu` admin user, like a fresh cloud or Proxmox image. systemd-binfmt is masked:
# in a privileged container it would reset Docker Desktop's binfmt handlers for every container.
FROM ubuntu:24.04
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo curl ca-certificates iproute2 openssh-server \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && (id ubuntu || useradd -m -s /bin/bash ubuntu) && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
 && systemctl mask systemd-logind.service getty.target console-getty.service systemd-binfmt.service proc-sys-fs-binfmt_misc.mount proc-sys-fs-binfmt_misc.automount 2>/dev/null; true
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
