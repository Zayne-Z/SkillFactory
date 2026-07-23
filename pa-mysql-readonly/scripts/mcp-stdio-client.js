const { spawn } = require('node:child_process');

class McpStdioClient {
  constructor({ command, args = [], cwd = process.cwd(), env = process.env, timeoutMs = 120000, shell = false }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.shell = shell;
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
  }

  async start() {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: this.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-12000);
    });
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', (code, signal) => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`MCP 服务在响应前退出（退出码=${code ?? 'null'}，信号=${signal || 'none'}）。`));
      }
      this.child = null;
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    while (true) {
      if (/^Content-Length:/i.test(this.buffer)) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = this.buffer.slice(0, headerEnd);
        const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
        if (!lengthMatch) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        const contentLength = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        if (Buffer.byteLength(this.buffer.slice(bodyStart), 'utf8') < contentLength) return;
        const bodyBuffer = Buffer.from(this.buffer.slice(bodyStart), 'utf8');
        const body = bodyBuffer.subarray(0, contentLength).toString('utf8');
        this.buffer = bodyBuffer.subarray(contentLength).toString('utf8');
        this.handleLine(body);
        continue;
      }
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.handleLine(line);
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || `MCP error ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) this.respondToServerRequest(message);
  }

  respondToServerRequest(message) {
    if (!this.child?.stdin.writable) return;
    let response;
    if (message.method === 'ping') response = { jsonrpc: '2.0', id: message.id, result: {} };
    else if (message.method === 'roots/list') response = { jsonrpc: '2.0', id: message.id, result: { roots: [] } };
    else response = { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `不支持的客户端方法：${message.method}` } };
    this.child.stdin.write(`${JSON.stringify(response)}\n`);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('MCP 服务未运行。'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求 ${method} 在 ${this.timeoutMs} 毫秒后超时。`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'pa-mysql-readonly-skill', version: '1.1.0' },
    });
    this.notify('notifications/initialized');
    return result;
  }

  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  listTools() {
    return this.request('tools/list');
  }

  listResources() {
    return this.request('resources/list');
  }

  readResource(uri) {
    return this.request('resources/read', { uri });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try {
      child.stdin.end();
    } catch {
      // Process may already have exited.
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve();
      }, 250);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

module.exports = { McpStdioClient };
