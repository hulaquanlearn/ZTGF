import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Compute once per Web start. Deploy all front-end files together and restart Web.
export async function createAppVersionHandler(publicDirectory) {
  const hash = crypto.createHash('sha256');
  async function visit(directory) {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:js|css|html)$/.test(entry.name)) {
        const name = path.relative(publicDirectory, file).split(path.sep).join('/');
        hash.update(JSON.stringify(name));
        hash.update(crypto.createHash('sha256').update(await fs.readFile(file)).digest());
      }
    }
  }
  await visit(publicDirectory);
  const webRevision = hash.digest('hex');
  return async (_req, res, next) => {
    try {
      let android = null;
      try {
        const release = JSON.parse(await fs.readFile(path.join(publicDirectory, 'android-release.json'), 'utf8'));
        if (Number.isSafeInteger(release.versionCode) && release.versionCode > 0
          && typeof release.versionName === 'string' && release.versionName.length <= 40
          && /^\/android\/[a-zA-Z0-9._-]+\.apk$/.test(release.apkPath)) {
          const stat = await fs.stat(path.join(publicDirectory, release.apkPath));
          if (stat.isFile()) android = { versionCode: release.versionCode, versionName: release.versionName, apkPath: release.apkPath };
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      res.set('Cache-Control', 'no-store').json({ webRevision, android });
    } catch (error) { next(error); }
  };
}
