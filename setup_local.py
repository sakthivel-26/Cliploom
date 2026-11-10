"""Create machine-specific stdio MCP config. No paid API keys."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
config = {'mcpServers': {'cliploom': {'command': sys.executable, 'args': [str(root / 'mcp_server.py')]}}}
(root / 'mcp-config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
print('Local MCP configuration saved.')
