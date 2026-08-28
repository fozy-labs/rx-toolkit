import { defineConfig, devices } from "@playwright/test";

const port = 3101;
const isCI = Boolean(process.env.CI);

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    reporter: isCI ? "github" : "list",
    use: {
        baseURL: `http://localhost:${port}`,
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: `npx vite --port ${port} --strictPort`,
        url: `http://localhost:${port}/`,
        reuseExistingServer: !isCI,
        timeout: 60_000,
    },
});
