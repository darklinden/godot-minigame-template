class Headers {
  constructor(init = {}) {
    this.map = Object.create(null);

    if (init instanceof Headers) {
      init.forEach((value, key) => {
        this.append(key, value);
      });
    } else if (typeof init === 'object' && init !== null) {
      Object.keys(init).forEach(key => {
        this.append(key, init[key]);
      });
    }
  }

  append(name, value) {
    name = name.toLowerCase();
    if (this.map[name]) {
      this.map[name] += ', ' + value;
    } else {
      this.map[name] = String(value);
    }
  }

  set(name, value) {
    this.map[name.toLowerCase()] = String(value);
  }

  get(name) {
    return this.map[name.toLowerCase()] || null;
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.map, name.toLowerCase());
  }

  delete(name) {
    delete this.map[name.toLowerCase()];
  }

  forEach(callback) {
    for (let key in this.map) {
      callback(this.map[key], key, this);
    }
  }
}

// Simulated ReadableStream — wraps a single binary chunk (Uint8Array).
class SimulatedReadableStream {
  constructor(content) {
    this._content = content;
    this.locked = false;
  }
  getReader() {
    if (this.locked) {
      throw new Error("Stream is already locked");
    }
    this.locked = true;
    let done = false;
    return {
      read: () => {
        if (!done) {
          done = true;
          return Promise.resolve({ value: this._content, done: false });
        } else {
          return Promise.resolve({ done: true });
        }
      },
      releaseLock: () => {
        this.locked = false;
      },
      cancel: () => {
        this.locked = false;
        return Promise.resolve();
      }
    };
  }
}

// Simulated Response class — binary-only, compatible with the browser Response
// API that Godot's fetch bridge expects.
class Response {
  constructor(body, options = {}) {
    this._bodyContent = body;
    this.status = options.status || 200;
    this.statusText = options.statusText || 'OK';
    this.headers = new Headers(options.headers);
    this.url = options.url || '';
    this.ok = this.status >= 200 && this.status < 300;
    this.bodyUsed = false;

    if (body != null) {
      // body is always an ArrayBuffer from wx.request (responseType "arraybuffer").
      this.body = new SimulatedReadableStream(new Uint8Array(body));
    } else {
      this.body = null;
    }
  }

  _consumeBody() {
    if (this.bodyUsed) {
      return Promise.reject(new TypeError("Body has already been consumed."));
    }
    this.bodyUsed = true;
    if (!this.body) {
      return Promise.resolve(new Uint8Array(0));
    }
    const reader = this.body.getReader();
    return reader.read().then(result => {
      reader.releaseLock();
      return result.value || new Uint8Array(0);
    });
  }

  /** Return body as text, decoded from binary. */
  text() {
    return this._consumeBody().then(content => {
      return new TextDecoder().decode(content);
    });
  }

  /** Return body parsed as JSON. */
  json() {
    return this.text().then(text => {
      try {
        return JSON.parse(text);
      } catch (error) {
        return Promise.reject(new Error("Invalid JSON: " + error.message));
      }
    });
  }

  /** Return body as ArrayBuffer — a copy of the underlying buffer. */
  arrayBuffer() {
    return this._consumeBody().then(content => {
      return content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength
      );
    });
  }
}


function Fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.headers.reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {});

    // wx.request only accepts ArrayBuffer, not typed array views.
    // options.body is a Uint8Array from Godot's WASM heap — extract its backing
    // ArrayBuffer.  Use ArrayBuffer.isView() instead of instanceof because the
    // typed array may come from a different realm (WASM) where its constructor
    // prototype chain does not match the global Uint8Array.
    let data = options.body || {};
    if (ArrayBuffer.isView(options.body)) {
      data = options.body.buffer.slice(
        options.body.byteOffset,
        options.body.byteOffset + options.body.byteLength
      );
    }

    wx.request({
      url,
      method: options.method || 'GET',
      data: data,
      header: headers,
      dataType: "",
      responseType: "arraybuffer",
      success(res) {
        const response = new Response(res.data, {
          status: res.statusCode,
          statusText: res.errMsg,
          headers: res.header,
        });
        resolve(response);
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

// Mount on the WeChat global so it replaces the built-in fetch.
GameGlobal.fetch = Fetch;
GameGlobal.Headers = Headers;
GameGlobal.Response = Response;
