export declare class VirtualFS {
    private files;
    constructor(fixture?: Record<string, string>);
    private resolve;
    read(p: string): string;
    write(p: string, content: string): void;
    list(dir?: string): string[];
    snapshot(): Record<string, string>;
}
