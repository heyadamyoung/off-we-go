import ActivityKit
import Capacitor
import Foundation

/* The bridge from the web side to ActivityKit.
 *
 * Four verbs — start, update, end, current — and no opinions: which leg is on
 * the card and what it says is decided in live-activity-core and tested
 * there. This turns that into an Activity, keeps exactly one alive, and says
 * plainly why it could not.
 *
 * iOS 16.2 rather than 16.1, where Live Activities first appeared: 16.2 is
 * where ActivityContent landed, and every device that reached 16.1 could
 * take 16.2. One code path beats two.
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.reject("Live Activities need iOS 16.2") }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return call.reject("Live Activities are switched off for Off We Go in Settings")
        }
        guard let attributes: TravelActivityAttributes = decode(call.getObject("attributes")),
              let state: TravelActivityAttributes.ContentState = decode(call.getObject("state"))
        else { return call.reject("A card needs attributes and a state") }
        Task {
            do {
                let id = try await TravelActivities.start(attributes, state)
                call.resolve(["id": id])
            } catch {
                call.reject("The card could not be started: \(error.localizedDescription)")
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.reject("Live Activities need iOS 16.2") }
        guard let state: TravelActivityAttributes.ContentState = decode(call.getObject("state"))
        else { return call.reject("An update needs a state") }
        Task {
            await TravelActivities.update(state)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.reject("Live Activities need iOS 16.2") }
        let last: TravelActivityAttributes.ContentState? = decode(call.getObject("state"))
        Task {
            await TravelActivities.end(last)
            call.resolve()
        }
    }

    /// Whatever survived the app being killed: the web side reconciles against
    /// this on launch rather than starting a second card beside the first.
    @objc func current(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let live = TravelActivities.current() else {
            return call.resolve(["id": NSNull(), "segmentId": NSNull()])
        }
        call.resolve(["id": live.id, "segmentId": live.attributes.segmentId])
    }

    /* JSON in, a value out. Dates arrive as the ISO strings JavaScript writes,
       fractional seconds and all, which the stock ISO8601 strategy refuses. */
    private func decode<T: Decodable>(_ object: JSObject?) -> T? {
        guard let object, let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { from in
            let text = try from.singleValueContainer().decode(String.self)
            if let date = IsoDates.parse(text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: from.codingPath, debugDescription: "not a date: \(text)"))
        }
        return try? decoder.decode(T.self, from: data)
    }
}

enum IsoDates {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let whole: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ text: String) -> Date? {
        fractional.date(from: text) ?? whole.date(from: text)
    }
}

/* One card at a time. A second Activity for a second leg would stack on the
   Lock Screen; the web side moves the card from leg to leg, and this end
   keeps the invariant however many requests arrive. */
@available(iOS 16.2, *)
enum TravelActivities {
    typealias Travel = Activity<TravelActivityAttributes>

    static func current() -> Travel? {
        Travel.activities.first
    }

    static func start(_ attributes: TravelActivityAttributes, _ state: TravelActivityAttributes.ContentState) async throws -> String {
        for stale in Travel.activities where stale.attributes.segmentId != attributes.segmentId {
            await stale.end(nil, dismissalPolicy: .immediate)
        }
        if let same = Travel.activities.first(where: { $0.attributes.segmentId == attributes.segmentId }) {
            await same.update(content(state))
            return same.id
        }
        let activity = try Travel.request(attributes: attributes, content: content(state), pushType: nil)
        return activity.id
    }

    static func update(_ state: TravelActivityAttributes.ContentState) async {
        for activity in Travel.activities {
            await activity.update(content(state))
        }
    }

    /// With a final state the card lingers to say Landed, then goes; without
    /// one it goes now.
    static func end(_ last: TravelActivityAttributes.ContentState?) async {
        for activity in Travel.activities {
            if let last {
                await activity.end(ActivityContent(state: last, staleDate: nil), dismissalPolicy: .after(.now + 15 * 60))
            } else {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    /* Stale a little after the deadline it counts to: if no update has come by
       then, the system dims the card rather than letting it assert a
       boarding time that has passed. */
    private static func content(_ state: TravelActivityAttributes.ContentState) -> ActivityContent<TravelActivityAttributes.ContentState> {
        ActivityContent(state: state, staleDate: state.deadlineAt.map { $0.addingTimeInterval(10 * 60) })
    }
}
