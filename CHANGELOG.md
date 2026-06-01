# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-01

### Added
- Initial release
- 45+ OpenCode Zen models registered as Copilot Language Model Provider
- 4 free models enabled by default: `deepseek-v4-flash-free`, `mimo-v2.5-free`, `nemotron-3-super-free`, `big-pickle`
- Auto-detection of OpenCode installation and API key
- Tool calling support with automatic JSON repair
- SSE streaming with reasoning content display
- Vision/image input for multimodal models
- Status bar indicator with connection state
- Commands: Configure, Test Connection, Refresh Models, Show Output
- Settings: timeout, tool calling, image input, temperature, verbose logging
- Model catalog from builtin metadata, models.dev, and Zen API
