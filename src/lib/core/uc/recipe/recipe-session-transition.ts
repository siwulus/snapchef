import type { RecipeSessionRepository } from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { UserId } from "@/lib/core/model/auth";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { type RecipeSessionEvent, nextState } from "@/lib/core/model/recipe/recipe-session-state-machine";
import { getOrThrowNotFound } from "@/lib/utils/effect";
import { Effect } from "effect";

export interface TransitionOutcome<A> {
  // Whatever the business action produced.
  result: A;
  // The authoritative post-transition session (state already advanced).
  session: RecipeSession;
}

export interface SessionStateManager {
  run<A>(
    event: RecipeSessionEvent,
    userId: UserId,
    sessionId: string,
    action: (session: RecipeSession) => Effect.Effect<A, SnapchefServerError>,
  ): Effect.Effect<TransitionOutcome<A>, SnapchefServerError>;
}

// The transition aspect: the single envelope every mutating recipe-session operation runs inside.
//   1. load + own the session (find → NotFound on miss)
//   2. GUARD: derive the target state via nextState (fails Conflict 409 before any side effect)
//   3. WORK: run the business action (data-only writes) — only reached when the event is legal
//   4. CLOSE: write the derived state via the sole state-writer `transition`, returning the
//      post-transition session alongside the action's result.
export const createSessionStateManager = (repository: RecipeSessionRepository): SessionStateManager => ({
  run: (event, userId, sessionId, action) =>
    repository.find(userId, sessionId).pipe(
      Effect.flatMap(getOrThrowNotFound("Session not found")),
      Effect.flatMap((session) =>
        nextState(event)(session.state).pipe(
          Effect.flatMap((to) =>
            action(session).pipe(
              Effect.flatMap((result) =>
                repository.transition(userId, sessionId, to).pipe(
                  Effect.flatMap(getOrThrowNotFound("Session not found")),
                  Effect.map((transitioned) => ({ result, session: transitioned })),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
});
