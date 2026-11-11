import { VirtualFS } from './virtual-fs.js';
export interface ToolResult {
    content: string;
    isError: boolean;
}
export interface ToolDef {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export declare const toolDefs: ToolDef[];
export declare function safeCalculate(expression: string): number;
export declare class MockTools {
    readonly fs: VirtualFS;
    constructor(fixture: Record<string, string>);
    call(name: string, args: Record<string, unknown>): ToolResult;
    private dispatch;
}
