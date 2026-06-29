/**
 * Per-conversation mutual-exclusion lock shared by the manager-turn runner
 * (ChatActivityManager) and the consultation runner (ConsultationActivityManager).
 *
 * Both append turns to the same conversation and are read-only against the repo,
 * but letting a manager turn and a consultation run in the same conversation at
 * once interleaves their turns confusingly and races conversation state. This
 * lock guarantees at most one of them is active per conversation at a time.
 *
 * Single-threaded by construction: isBusy() then acquire() within one
 * synchronous submit path is atomic (no await between them).
 */
export class ConversationActivityLock {
  private readonly busy = new Set<string>();

  isBusy(conversationId: string): boolean {
    return this.busy.has(conversationId);
  }

  acquire(conversationId: string): void {
    this.busy.add(conversationId);
  }

  release(conversationId: string): void {
    this.busy.delete(conversationId);
  }
}
