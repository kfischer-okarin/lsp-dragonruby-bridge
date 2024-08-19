# LSP HTTP Relay

[![Tests](./actions/workflows/test.yml/badge.svg)](./actions/workflows/test.yml)

Relays LSP messages between `stdin`/`stdout` and a HTTP endpoint.

It can be used to provide a LSP entry point via the default stream based interface to communicate with a
Language Server that communicates only via HTTP requests.
