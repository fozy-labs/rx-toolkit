#!/usr/bin/env node
import { runCli } from "./cli/runCli.js";

process.exitCode = runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
