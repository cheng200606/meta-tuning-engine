// G0 虚拟文件系统：每 episode 重置。路径限定在沙箱根内，拒绝越界。
import path from 'node:path';
export class VirtualFS {
    files = new Map();
    constructor(fixture = {}) {
        for (const [name, content] of Object.entries(fixture))
            this.write(name, content);
    }
    resolve(p) {
        const normalized = path.posix.normalize(p.replaceAll('\\', '/')).replace(/^\/+/, '');
        if (normalized.startsWith('..'))
            throw new Error(`path escapes sandbox: ${p}`);
        return normalized;
    }
    read(p) {
        const key = this.resolve(p);
        const content = this.files.get(key);
        if (content === undefined)
            throw new Error(`file not found: ${p}`);
        return content;
    }
    write(p, content) {
        this.files.set(this.resolve(p), content);
    }
    list(dir = '') {
        const prefix = this.resolve(dir === '' ? '' : dir + '/');
        const names = new Set();
        for (const key of this.files.keys()) {
            if (prefix === '' || key.startsWith(prefix)) {
                const rest = prefix === '' ? key : key.slice(prefix.length);
                names.add(rest.split('/')[0]);
            }
        }
        return [...names].sort();
    }
    snapshot() {
        return Object.fromEntries(this.files);
    }
}
