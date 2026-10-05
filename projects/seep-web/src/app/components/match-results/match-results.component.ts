import { Component, input } from '@angular/core'
import type { MatchResults, ResultHandSide } from '../../core/match-results'

/**
 * The results of a finished match: the final scores, who won and by how much, and a hand-by-hand table showing how each
 * hand's score was made (including a side's card points not counting because they missed the 9-point minimum). The same
 * component serves a two-player match (against a person or the computer) and a four-player team match, because the model
 * it is given (core/match-results.ts) is always "you / your team" first.
 */
@Component({
  selector: 'app-match-results',
  standalone: true,
  template: `
    <section id="results-panel" aria-label="Match results" style="box-sizing: border-box; width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 10px; padding: 0 12px;">
      @if (results().endedEarly; as why) {
        <p id="results-ended-early" style="text-align: center; font-style: italic; color: rgba(255,255,255,0.8); font-size: 14px;">Match ended early: {{ why }}</p>
      }

      <div id="results-final" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        @for (side of results().sides; track $index) {
          <div
            [attr.data-winner]="results().winner === $index"
            [style.border]="results().winner === $index ? '2px solid var(--gold-lt)' : '1px solid rgba(255,255,255,0.2)'"
            style="border-radius: 10px; padding: 8px 6px; text-align: center; background: rgba(0,0,0,0.25);"
          >
            <div style="font-size: 13px; color: rgba(255,255,255,0.85); font-weight: 700;">{{ side.label }}@if (side.isYou && side.label !== 'You') { (your team) }</div>
            @if (side.detail) {
              <div style="font-size: 11px; color: rgba(255,255,255,0.6);">{{ side.detail }}</div>
            }
            <div [style.color]="results().winner === $index ? 'var(--gold-lt)' : '#fff'" style="font-size: 30px; font-weight: 800; line-height: 1.2;">{{ results().final[$index] }}</div>
          </div>
        }
      </div>

      @if (results().winner !== null && !results().endedEarly) {
        <p id="results-lead" style="text-align: center; color: rgba(255,255,255,0.75); font-size: 13px;">Won by {{ results().lead }} points.</p>
      }

      @if (results().hands.length > 0 || results().earlier) {
        <div style="overflow-x: auto;">
          <table id="results-hands" style="width: 100%; border-collapse: collapse; font-size: 13px; color: #fff;">
            <caption style="text-align: left; color: rgba(255,255,255,0.7); font-size: 12px; padding-bottom: 4px;">Hand by hand</caption>
            <thead>
              <tr style="color: rgba(255,255,255,0.7); font-size: 12px;">
                <th scope="col" style="text-align: left; padding: 2px 4px;">Hand</th>
                <th scope="col" style="text-align: left; padding: 2px 4px;">{{ results().sides[0].label }}</th>
                <th scope="col" style="text-align: left; padding: 2px 4px;">{{ results().sides[1].label }}</th>
                <th scope="col" style="text-align: right; padding: 2px 4px;">Score</th>
              </tr>
            </thead>
            <tbody>
              @if (results().earlier; as e) {
                <tr id="results-earlier" style="border-top: 1px solid rgba(255,255,255,0.15);">
                  <th scope="row" style="text-align: left; padding: 4px; font-weight: 600;">Earlier</th>
                  <td style="padding: 4px;"><strong>{{ e[0] }}</strong></td>
                  <td style="padding: 4px;"><strong>{{ e[1] }}</strong></td>
                  <td style="padding: 4px; text-align: right;">{{ e[0] }} – {{ e[1] }}</td>
                </tr>
              }
              @for (hand of results().hands; track hand.number) {
                <tr [attr.data-hand]="hand.number" style="border-top: 1px solid rgba(255,255,255,0.15); vertical-align: top;">
                  <th scope="row" style="text-align: left; padding: 4px; font-weight: 600;">{{ hand.number }}</th>
                  @for (hs of hand.sides; track $index) {
                    <td style="padding: 4px;">
                      <strong>{{ hs.total }}</strong>
                      <div style="font-size: 11px; color: rgba(255,255,255,0.6);">{{ how(hs) }}</div>
                    </td>
                  }
                  <td style="padding: 4px; text-align: right; white-space: nowrap;">{{ hand.after[0] }} – {{ hand.after[1] }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (results().earlier) {
          <p id="results-earlier-note" style="font-size: 11px; color: rgba(255,255,255,0.6);">“Earlier” is the points from hands played before this match could be itemised.</p>
        }
        @if (results().hands.length > 0) {
          <p id="results-summary" style="text-align: center; font-size: 12px; color: rgba(255,255,255,0.7);">
            {{ results().hands.length }} {{ results().hands.length === 1 ? 'hand' : 'hands' }} itemised · hands won {{ results().handsWon[0] }}–{{ results().handsWon[1] }} · sweep points {{ results().sweepPoints[0] }}–{{ results().sweepPoints[1] }}
          </p>
        }
      } @else {
        <p id="results-no-hands" style="text-align: center; color: rgba(255,255,255,0.7); font-size: 13px;">No hand was completed.</p>
      }
    </section>
  `,
})
export class MatchResultsComponent {
  readonly results = input.required<MatchResults>()

  /** How one side's hand score was made, in a few words. */
  how(side: ResultHandSide): string {
    const sweep = side.sweeps > 0 ? ` + ${side.sweeps} sweep` : ''
    if (side.missedMinimum) return `${side.cardPoints} cards (under 9, none count)${sweep}`
    if (side.counted === 0 && side.sweeps === 0) return 'nothing'
    return `${side.counted} cards${sweep}`
  }
}
