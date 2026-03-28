# Playwright MCP Server Configuration

## Overview

This project is configured with the Playwright MCP (Model Context Protocol) server for browser automation capabilities. This enables:

- **Automated Testing**: Run tests against your React components in a real browser
- **Visual Verification**: Capture screenshots and perform visual regression testing
- **E2E Testing**: Full end-to-end testing of your application
- **Localhost Development**: Seamlessly test your application running on `localhost:5173` (Vite default)

## Configuration Files

The Playwright MCP server is configured in two files:

1. **`.mcp.json`** - Project-level configuration (used by Copilot CLI)
2. **`.vscode/mcp.json`** - VS Code workspace configuration (used by VS Code extensions)

Both files contain identical Playwright server configuration.

## Configuration Details

### Server Type

- **Type**: `stdio` (Standard Input/Output)
- **Command**: `npx @modelcontextprotocol/server-playwright`

### Launch Arguments

```
--launch                          # Auto-launch browser instances
--launch-args=--disable-gpu       # Disable GPU acceleration (stable for CI/testing)
--launch-args=--single-process    # Use single process mode (memory efficient)
```

### Environment Variables

```
PLAYWRIGHT_HEADLESS=true          # Run browser in headless mode (no GUI)
PLAYWRIGHT_BROWSERS_PATH=...      # Cache location for browser binaries
```

## Setup Instructions

### 1. Install Playwright

```bash
npm install --save-dev @playwright/test
# or with pnpm
pnpm add -D @playwright/test
```

### 2. Install Browsers

```bash
npx playwright install
```

### 3. Verify Configuration

```bash
# Test that MCP server is properly configured
copilot mcp servers list
```

## Usage Examples

### Testing Your Localhost Dev Server

1. **Start your development server:**

   ```bash
   npm run dev
   # Vite will typically run on http://localhost:5173
   ```

2. **Use Playwright through the MCP server** to:
   - Navigate to your localhost application
   - Interact with components
   - Take screenshots for visual verification
   - Run automated tests

Example Playwright commands (via Claude):

```javascript
// Navigate to localhost
await page.goto("http://localhost:5173");

// Interact with components
await page.click('button[type="submit"]');
await page.fill('input[type="text"]', "test input");

// Take screenshots
await page.screenshot({ path: "screenshot.png" });

// Wait for elements
await page.waitForSelector(".component-loaded");
```

## Vite Development Server

Your project uses Vite with Vite Plus. The dev server runs on:

- **Default Port**: `5173`
- **Start Command**: `npm run dev` or `pnpm dev`

You can access your application at `http://localhost:5173` for manual testing or through Playwright for automated testing.

## Project Structure

Your React + TypeScript project includes:

- **React 19.2.4** with latest TypeScript support
- **Tailwind CSS 4** for styling
- **Radix UI components** for accessible UI components
- **Testing Library** for component testing
- **jsdom** for DOM simulation

## Browser Support

Playwright supports multiple browsers:

- Chromium (default)
- Firefox
- WebKit (Safari)

All browsers are automatically downloaded during `playwright install`.

## Troubleshooting

### MCP Server Not Connecting

```bash
# Rebuild MCP server connection
copilot mcp reload
```

### Browser Launch Issues

- Ensure all Playwright browsers are installed: `npx playwright install`
- Check that `node_modules/.cache/ms-playwright` directory exists
- Try removing and reinstalling: `rm -rf node_modules && pnpm install`

### Localhost Connection Issues

- Verify dev server is running: `npm run dev`
- Check if port 5173 is available: `lsof -i :5173`
- Update the port in test files if you're using a different port

### Performance Issues

- The `--single-process` flag uses single-process mode for lower memory usage
- The `--disable-gpu` flag improves stability for headless testing
- These are sensible defaults; adjust if needed for your use case

## Configuration Customization

To modify the Playwright server configuration, edit:

- `.mcp.json` for project-level changes
- `.vscode/mcp.json` for VS Code changes

After editing, reload the MCP configuration:

```bash
copilot mcp reload
```

## Related Documentation

- [Playwright Documentation](https://playwright.dev)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)

## Notes

- Configuration uses sensible defaults optimized for development and testing
- Headless mode is enabled for stable automation
- Single-process mode reduces memory overhead
- GPU acceleration is disabled for better consistency in headless environments
