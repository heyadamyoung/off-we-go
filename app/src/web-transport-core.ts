/* The browser's own XMLHttpRequest, from underneath the one the native shell
   put in its place.

   CapacitorHttp is switched on for the app, and what that does is replace
   XMLHttpRequest.prototype.open and .send with a pair that hands the request
   to native code instead. The only way it knows to carry a file across that
   bridge is FileReader.readAsBinaryString followed by btoa: the whole file as
   a string, and then the whole file again a third longer, both held in the web
   view's heap before a single byte goes out. A three-megabyte photograph
   survives that. A minute of video off an iPhone is a few hundred megabytes
   and does not — the web view is killed for memory, or the conversion throws,
   and the patched send puts no catch on that promise, so the request
   dispatches neither load nor error and the upload hangs for ever with nothing
   said. Which is exactly what "videos do not upload from the app" looked like:
   a bar that never moved and no message anywhere.

   Capacitor keeps the real constructor and the real methods on
   window.CapacitorWebXMLHttpRequest before it patches over them, so the
   original transport is still there to be asked for. It streams a File out of
   a multipart body without ever holding it, and it reports upload progress,
   which the bridge has a TODO where it ought to have. The API names the
   shells' origins in its CORS allow-list already, so a direct request is one
   it answers.

   Only uploads come through here. Everything else this app sends is a few
   kilobytes of JSON, where the bridge costs nothing and spares a preflight. */

interface SavedXhr {
  constructor: new () => XMLHttpRequest
  open: XMLHttpRequest['open']
  send: XMLHttpRequest['send']
  setRequestHeader: XMLHttpRequest['setRequestHeader']
  getResponseHeader: XMLHttpRequest['getResponseHeader']
  abort: XMLHttpRequest['abort']
}

interface TransportScope {
  XMLHttpRequest?: new () => XMLHttpRequest
  CapacitorWebXMLHttpRequest?: Partial<SavedXhr>
}

export interface WebRequest {
  /** The request itself, for everything the patch never touched: the
      handlers, withCredentials, responseType, status, and upload progress. */
  xhr: XMLHttpRequest
  /** True when the shell's patched transport was stepped around. */
  direct: boolean
  open(method: string, url: string): void
  header(name: string, value: string): void
  responseHeader(name: string): string | null
  send(body: XMLHttpRequestBodyInit | null): void
  abort(): void
}

/* All of it or none of it. Half the original transport and half the patched
   one is a request opened one way and sent the other, which is an
   InvalidStateError rather than an upload. */
const savedIfWhole = (scope: TransportScope): SavedXhr | null => {
  const saved = scope.CapacitorWebXMLHttpRequest
  return saved?.constructor &&
    saved.open &&
    saved.send &&
    saved.setRequestHeader &&
    saved.getResponseHeader &&
    saved.abort
    ? (saved as SavedXhr)
    : null
}

export function webRequest(scope: TransportScope = globalThis as TransportScope): WebRequest {
  const saved = savedIfWhole(scope)
  const Transport = saved?.constructor || scope.XMLHttpRequest
  if (!Transport) throw new Error('This device cannot send files')
  const xhr = new Transport()
  return {
    xhr,
    direct: !!saved,
    /* Asynchronous, always and explicitly. The patched open the shell leaves
       on the prototype takes two arguments and never really opens anything. */
    open: (method, url) =>
      saved ? saved.open.call(xhr, method, url, true) : xhr.open(method, url, true),
    header: (name, value) =>
      saved ? saved.setRequestHeader.call(xhr, name, value) : xhr.setRequestHeader(name, value),
    responseHeader: name =>
      saved ? saved.getResponseHeader.call(xhr, name) : xhr.getResponseHeader(name),
    send: body => (saved ? saved.send.call(xhr, body) : xhr.send(body)),
    abort: () => (saved ? saved.abort.call(xhr) : xhr.abort()),
  }
}
