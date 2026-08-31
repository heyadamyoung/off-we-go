import { pathToFileURL } from 'node:url';

const udidPattern = /^(?:[0-9A-F]{40}|[0-9A-F]{8}-[0-9A-F]{16})$/i;

export function parseAdHocDevices(value) {
  let input;
  try { input = JSON.parse(String(value ?? '')); }
  catch { throw new Error('Expected Ad Hoc devices as a JSON object'); }
  if (!input || Array.isArray(input) || typeof input !== 'object' || !Object.keys(input).length) {
    throw new Error('Expected at least one Ad Hoc device');
  }

  const devices = {};
  const seen = new Set();
  for (const [rawName, rawUdid] of Object.entries(input)) {
    const name = String(rawName).trim();
    const udid = String(rawUdid).trim().toUpperCase();
    if (!name || name.length > 100 || /[\r\n]/.test(name)) {
      throw new Error('Every Ad Hoc device needs a valid name');
    }
    if (!udidPattern.test(udid)) {
      throw new Error(`${name} does not have a valid Apple UDID`);
    }
    if (seen.has(udid)) throw new Error(`Duplicate Ad Hoc device UDID for ${name}`);
    seen.add(udid);
    devices[name] = udid;
  }
  return devices;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(parseAdHocDevices(process.argv[2]))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 64; }
}
