# Unit Testing

This guide explains how to run and write unit tests for OpenHamClock. Tests use [Vitest](https://vitest.dev/) with a jsdom environment.

The initial testing setup and the first test suite (for `src/utils/dxClusterFilters.js`) were contributed by Rich Freedman, N2EHL, with the help of Claude Code.

## Running Tests

### Run tests in watch mode (recommended for development)

```bash
npm test
```

### Run tests once

```bash
npm run test:run
```

### Run tests with UI (interactive browser interface)

```bash
npm run test:ui
```

### Run tests with coverage report

```bash
npm run test:coverage
```

## Test File Structure

Tests are colocated with the code they cover — `foo.js` gets a `foo.test.js` next to it:

```text
openhamclock/
├── src/
│   ├── utils/
│   │   ├── dxClusterFilters.js      # Source file
│   │   ├── dxClusterFilters.test.js # Its tests, right next to it
│   │   ├── workedBefore.js
│   │   ├── workedBefore.test.js
│   │   └── ...
│   └── test/
│       └── setup.js                  # Shared test setup/configuration
├── vitest.config.js                  # Vitest configuration
└── package.json                      # Test scripts
```

Server-side code follows the same pattern (e.g. `server/routes/dxNewsRoute.test.js`).

## Writing Tests

Follow this pattern:

```javascript
import { describe, it, expect } from 'vitest';
import { applyDXFilters } from './dxClusterFilters.js';

describe('Feature Name', () => {
  it('should do something specific', () => {
    const spot = {
      dxCall: 'W1AW',
      spotter: 'K2ABC',
      freq: '14.074',
      comment: 'FT8',
    };
    const filters = {
      /* your filters */
    };

    expect(applyDXFilters(spot, filters)).toBe(true);
  });
});
```

Guidelines:

- Prefer testing pure utility functions (`src/utils/`) — they need no mocking.
- New utility modules should ship with tests; PRs that change filtering, parsing, or geo math are expected to update the corresponding tests.
- Use `.js` extensions in import paths.

## CI Integration

CI (`.github/workflows/ci.yml`) already runs the full suite on every push and pull request via `npx vitest run`, alongside the Prettier format check (`npm run format:check`) and the translation key-order check (`npm run lang:check`). A PR with failing tests will not pass CI.

## Troubleshooting

### Tests not running?

1. Make sure all dependencies are installed: `npm ci`
2. Check that Node.js is v20.19 or later: `node --version`

### Import errors?

- Ensure file paths use `.js` extensions in imports
- Check that `vitest.config.js` is in the project root

### Coverage not generating?

- Make sure dependencies are installed (`@vitest/coverage-v8` is a devDependency): `npm ci`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest UI](https://vitest.dev/guide/ui.html)
- [Coverage Documentation](https://vitest.dev/guide/coverage.html)
