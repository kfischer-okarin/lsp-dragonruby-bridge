const http = require('http');

exports.buildLspMessageForwarder = () => new LspMessageForwarder();

class LspMessageForwarder {
  #messageStreamReader;

  constructor() {
    this.#messageStreamReader = new LspMessageStreamReader();
    this.#waitForEditor();
  }

  async processIncomingData(data) {
    this.#messageStreamReader.processIncomingData(data);

    while (this.#messageStreamReader.hasReadyMessages) {
      const message = this.#messageStreamReader.takeNextReadyMessage();

      this.#processMessage(message);

      await this.#postLspMessageToServer(
        message,
        {
          onConnectionRefused: () => {
            if (this.#state.connectedToServer) {
              this.#startReconnectingToServer();
            }
          },
        },
      );
    }
  }

  postInitializeMessageToServer() {
    this.#postLspMessageToServer(
      this.#state.initializeMessage,
      { onConnectionRefused: () => {} },
    );
  }

  #processMessage(message) {
    if (this.#state.waitingForEditor && isInitializeMessage(message)) {
      this.#startConnectingToServer(message);
    }
  }

  async #postLspMessageToServer(message, { onConnectionRefused }) {
    try {
      const response = await postToURL('http://localhost:9001/dragon/lsp', message.raw);

      if (response.status === 204) {
        return;
      }

      const shouldReturnResponse = this.#state.connectingToServer || this.#state.connectedToServer;
      if (shouldReturnResponse) {
        process.stdout.write(
          `Content-Length: ${response.body.length}\r\n` +
            '\r\n' +
            response.body
        );
      }

      if (this.#state.connectingToServer) {
        this.#startForwardingMessages();
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' && onConnectionRefused) {
        onConnectionRefused();
        return;
      }
      throw error;
    }
  }

  // --- state management ---
  #state;

  #waitForEditor() {
    this.#state = { waitingForEditor: true };
  }

  #startConnectingToServer(initializeMessage) {
    this.#state = {
      connectingToServer: true,
      initializeMessage,
      connectInterval: setInterval(
        tryToSendInitializeMessage,
        500,
        this,
      ),
    };
  }

  #startForwardingMessages() {
    if (this.#state.connectInterval) {
      clearInterval(this.#state.connectInterval);
    }

    this.#state = {
      connectedToServer: true,
      initializeMessage: this.#state.initializeMessage
    };
  }

  #startReconnectingToServer() {
    this.#state = {
      reconnectingToServer: true,
      initializeMessage: this.#state.initializeMessage,
      connectInterval: setInterval(
        tryToSendInitializeMessage,
        500,
        this,
      ),
    };
  }
}

// --- private functions ---

class LspMessageStreamReader {
  #collectedData;
  #readyMessages;

  constructor() {
    this.#collectedData = '';
    this.#readyMessages = [];
  }

  get hasReadyMessages() {
    return this.#readyMessages.length > 0;
  }

  takeNextReadyMessage() {
    return this.#readyMessages.shift();
  }

  processIncomingData(data) {
    this.#collectedData += data;

    let message = this.#tryToConsumeLspMessage();
    while (message) {
      this.#readyMessages.push(message);
      message = this.#tryToConsumeLspMessage();
    }
  }

  #tryToConsumeLspMessage() {
    const headerMatch = this.#collectedData.match(/Content-Length: (\d+)\r\n\r\n/);
    if (!headerMatch) {
      return null;
    }

    const contentLength = parseInt(headerMatch[1], 10);
    const contentStart = headerMatch.index + headerMatch[0].length;
    const contentEnd = contentStart + contentLength;

    if (this.#collectedData.length < contentEnd) {
      return null;
    }

    const rawMessage = this.#collectedData.slice(contentStart, contentEnd);

    this.#collectedData = this.#collectedData.slice(contentEnd);

    return {
      raw: rawMessage,
      parsed: JSON.parse(rawMessage),
    };
  };
}

const isInitializeMessage = (message) => message && message.parsed && message.parsed.method === 'initialize';

const postToURL = (url, requestBody) => new Promise((resolve, reject) => {
  const request = http.request(
    url,
    { method: 'POST' },
    (response) => {
      const bodyChunks = [];

      response.on('data', (chunk) => {
        bodyChunks.push(chunk);
      });

      response.on('end', () => {
        const body = Buffer.concat(bodyChunks).toString();
        resolve({
          status: response.statusCode,
          body,
        });
      });
    }
  );

  request.on('error', reject);
  request.setHeader('Content-Type', 'application/json');
  request.write(requestBody);
  request.end();
});

const tryToSendInitializeMessage = async (forwarder) => {
  forwarder.postInitializeMessageToServer();
};