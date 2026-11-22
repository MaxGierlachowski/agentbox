export class SoulService {
  get() {
    return { markdown: "", generated: "" }
  }
  save(markdown: string) {
    return { markdown, generated: "" }
  }
  regenerate(_ai: boolean) {
    return this.get()
  }
}
