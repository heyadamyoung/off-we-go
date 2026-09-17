import ActivityKit
import SwiftUI
import WidgetKit

/* The card itself: Lock Screen and Dynamic Island.
 *
 * On a travel day somebody looks at their phone thirty times and opens the
 * app twice. This is the other twenty-eight glances — the leg, the gate, what
 * the countdown is to and whether they will make it — without unlocking,
 * without finding the app, without the tab.
 *
 * The countdown is drawn by the system from the deadline, so it ticks with no
 * help from anybody; the app only speaks when something real changes. Colours
 * are the app's own: its dark ground, its one amber, its verdict greens and
 * ambers, so the card reads as the same object as the screen behind it.
 */
struct TravelActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TravelActivityAttributes.self) { context in
            LockScreenCard(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Palette.ground)
                .activitySystemActionForegroundColor(Palette.ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Text(context.attributes.glyph)
                        Text(context.attributes.title).font(.headline.weight(.bold))
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Where(state: context.state).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(context.attributes.from + " → " + context.attributes.to)
                            .font(.caption).foregroundStyle(Palette.muted)
                        Spacer()
                        Text(context.state.deadlineLabel).font(.caption).foregroundStyle(Palette.muted)
                        Countdown(state: context.state).font(.title3.monospacedDigit().weight(.semibold))
                        Verdict(state: context.state)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Text(context.attributes.glyph)
                    Text(context.attributes.title).font(.caption.weight(.semibold))
                }
            } compactTrailing: {
                Countdown(state: context.state)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(maxWidth: 56)
            } minimal: {
                Text(context.attributes.glyph)
            }
            .keylineTint(Palette.accent)
        }
    }
}

enum Palette {
    static let ground = Color(red: 0.043, green: 0.051, blue: 0.067)
    static let ink = Color(red: 0.902, green: 0.914, blue: 0.933)
    static let muted = Color(red: 0.600, green: 0.639, blue: 0.698)
    static let accent = Color(red: 0.941, green: 0.651, blue: 0.235)
    static let ok = Color(red: 0.290, green: 0.871, blue: 0.502)
    static let tight = Color(red: 1.000, green: 0.604, blue: 0.420)
}

struct LockScreenCard: View {
    let attributes: TravelActivityAttributes
    let state: TravelActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(attributes.glyph)
                Text(attributes.title).font(.headline.weight(.bold))
                Text(attributes.from + " → " + attributes.to).font(.subheadline).foregroundStyle(Palette.muted)
                Spacer()
                Where(state: state)
            }
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.deadlineLabel.uppercased())
                        .font(.caption2.weight(.bold)).tracking(1).foregroundStyle(Palette.muted)
                    Countdown(state: state).font(.system(size: 30, weight: .semibold, design: .rounded).monospacedDigit())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Verdict(state: state)
                    if !state.moved.isEmpty {
                        Text(state.moved).font(.caption.weight(.semibold)).foregroundStyle(Palette.tight)
                    } else if state.status == "cancelled" {
                        Text("Cancelled").font(.caption.weight(.semibold)).foregroundStyle(Palette.tight)
                    }
                }
            }
        }
        .padding(14)
        .foregroundStyle(Palette.ink)
    }
}

/* Gate, platform or terminal — whichever the leg has, in the accent, because
   it is the one thing on the card somebody is walking towards. */
struct Where: View {
    let state: TravelActivityAttributes.ContentState

    var body: some View {
        if let gate = state.gate, !gate.isEmpty {
            HStack(spacing: 4) {
                Text("Gate").font(.caption).foregroundStyle(Palette.muted)
                Text(gate).font(.headline.weight(.bold)).foregroundStyle(Palette.accent)
                if let was = state.gateWas, !was.isEmpty {
                    Text(was).font(.caption).strikethrough().foregroundStyle(Palette.muted)
                }
            }
        } else if let platform = state.platform, !platform.isEmpty {
            HStack(spacing: 4) {
                Text("Platform").font(.caption).foregroundStyle(Palette.muted)
                Text(platform).font(.headline.weight(.bold)).foregroundStyle(Palette.accent)
            }
        } else if let terminal = state.terminal, !terminal.isEmpty {
            Text("T" + terminal).font(.headline.weight(.bold)).foregroundStyle(Palette.accent)
        }
    }
}

/* Drawn by the system, so it ticks without a single update from the app. A
   deadline already behind us is "now", not a timer counting up from zero. */
struct Countdown: View {
    let state: TravelActivityAttributes.ContentState

    var body: some View {
        if let deadline = state.deadlineAt, deadline > .now {
            Text(timerInterval: Date.now...deadline, countsDown: true)
        } else if state.phase == "landed" {
            Text("✓")
        } else {
            Text("now")
        }
    }
}

struct Verdict: View {
    let state: TravelActivityAttributes.ContentState

    var body: some View {
        if let verdict = state.verdict {
            HStack(spacing: 5) {
                Circle().fill(colour(verdict)).frame(width: 7, height: 7)
                Text(state.verdictWord).font(.caption.weight(.semibold))
            }
        }
    }

    private func colour(_ verdict: String) -> Color {
        switch verdict {
        case "late": return Palette.tight
        case "tight": return Palette.accent
        default: return Palette.ok
        }
    }
}
