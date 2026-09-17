import Capacitor
import UIKit

/* The bridge's view controller, so the app's own plugins have somewhere to
   be registered. A plugin that lives in the app rather than in a pod is not
   found by Capacitor on its own; it is handed to the bridge here, once, as
   the web view comes up. Main.storyboard names this class. */
class OffWeGoViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
