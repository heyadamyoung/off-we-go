import ActivityKit
import Foundation

/* The card on the Lock Screen, as data.
 *
 * Compiled into both the app and the widget extension, because ActivityKit
 * pairs the two by this type: the app starts an Activity with these
 * attributes, the extension draws whatever Activity carries them. One file,
 * two targets, and the name is the contract.
 *
 * Nothing is decided here. What the card says — which leg, which deadline,
 * whether they will make it — is worked out on the web side in
 * live-activity-core, where it is tested; this is the shape it arrives in.
 */
@available(iOS 16.2, *)
struct TravelActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// before · boarding · airborne · landed
        var phase: String
        /// scheduled · delayed · changed · cancelled · done
        var status: String
        var gate: String?
        var gateWas: String?
        var terminal: String?
        var platform: String?
        /// what the countdown is to — "Boarding", "Doors close", "Lands"
        var deadlineLabel: String
        /// nil once there is nothing left to count to
        var deadlineAt: Date?
        var departsAt: Date
        var arrivesAt: Date?
        /// "25 min later", or empty when the plan held
        var moved: String
        /// here · ok · tight · late, or nil when nobody's position says
        var verdict: String?
        var verdictWord: String
    }

    var segmentId: String
    var mode: String
    var glyph: String
    /// "KL 677"
    var title: String
    /// "AMS"
    var from: String
    /// "YYC"
    var to: String
    var fromName: String
    var toName: String
}
