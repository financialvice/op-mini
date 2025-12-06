---
source-url: https://github.com/vercel/examples/tree/b57e42907f4eaec7b0d654706ff3e84ae478d710/apps/vibe-coding-platform/ai/tools
updated-at: 09-25-2025
---

# Vercel Vibe Coding Platform Tool Examples

Vercel worked directly with OpenAI to optimize the following tools _specifically_ for use by gpt-5. Below are the final tool interfaces and descriptions that they created through extensive performance evaluation and testing. Notice the unique strategies and patterns used and reinforced throughout. Notice the use of `.describe` to provide additional details for specific input parameters. Notice the use of markdown and XML. Notice the incorporation of best practices, when to use the tool, when not to use the tool, examples, counterexamples, and more.

The examples below are not representative of all possible strategies or general optimization, but represent an anecdotal positive example for this specific use case (ai coding), implementation, and model (gpt-5). When optimizing tool design and descriptions, always experiment with a diverse range of strategies and iteratively improve performance through rigorous evaluation and testing (see `docs/writing-effective-tools-for-agents.md`).

## files
file: ai/tools/create-sandbox.md
```md
Use this tool to create a new Vercel Sandbox — an ephemeral, isolated Linux container that serves as your development environment for the current session. This sandbox provides a secure workspace where you can upload files, install dependencies, run commands, start development servers, and preview web apps. Each sandbox is uniquely identified and must be referenced for all subsequent operations (e.g., file generation, command execution, or URL access).

## When to Use This Tool

Use this tool **once per session** when:

1. You begin working on a new user request that requires code execution or file creation
2. No sandbox currently exists for the session
3. The user asks to start a new project, scaffold an application, or test code in a live environment
4. The user requests a fresh or reset environment

## Sandbox Capabilities

After creation, the sandbox allows you to:

- Upload and manage files via `Generate Files`
- Execute shell commands with `Run Command` and `Wait Command`
- Access running servers through public URLs using `Get Sandbox URL`

Each sandbox mimics a real-world development environment and supports rapid iteration and testing without polluting the local system. The base system is Amazon Linux 2023 with the following additional packages:

```
bind-utils bzip2 findutils git gzip iputils libicu libjpeg libpng ncurses-libs openssl openssl-libs pnpm procps tar unzip which whois zstd
```

You can install additional packages using the `dnf` package manager. You can NEVER use port 8080 as it is reserved for internal applications. When requested, you need to use a different port.

## Best Practices

- Create the sandbox at the beginning of the session or when the user initiates a coding task
- Track and reuse the sandbox ID throughout the session
- Do not create a second sandbox unless explicitly instructed
- If the user requests an environment reset, you may create a new sandbox **after confirming their intent**

## Examples of When to Use This Tool

<example>
User: Can we start fresh? I want to rebuild the project from scratch.
Assistant: Got it — I’ll create a new sandbox so we can start clean.
*Calls Create Sandbox*
</example>

## When NOT to Use This Tool

Skip using this tool when:

1. A sandbox has already been created for the current session
2. You only need to upload files (use Generate Files)
3. You want to execute or wait for a command (use Run Command / Wait Command)
4. You want to preview the application (use Get Sandbox URL)
5. The user hasn’t asked to reset the environment

## Summary

Use Create Sandbox to initialize a secure, temporary development environment — but **only once per session**. Treat the sandbox as the core workspace for all follow-up actions unless the user explicitly asks to discard and start anew.
```

file: ai/tools/create-sandbox.ts
```ts
import type { UIMessageStreamWriter, UIMessage } from 'ai'
import type { DataPart } from '../messages/data-parts'
import { Sandbox } from '@vercel/sandbox'
import { getRichError } from './get-rich-error'
import { tool } from 'ai'
import description from './create-sandbox.md'
import z from 'zod'

interface Params {
  writer: UIMessageStreamWriter<UIMessage<never, DataPart>>
}

export const createSandbox = ({ writer }: Params) =>
  tool({
    description,
    inputSchema: z.object({
      timeout: z
        .number()
        .min(600000)
        .max(2700000)
        .optional()
        .describe(
          'Maximum time in milliseconds the Vercel Sandbox will remain active before automatically shutting down. Minimum 600000ms (10 minutes), maximum 2700000ms (45 minutes). Defaults to 600000ms (10 minutes). The sandbox will terminate all running processes when this timeout is reached.'
        ),
      ports: z
        .array(z.number())
        .max(2)
        .optional()
        .describe(
          'Array of network ports to expose and make accessible from outside the Vercel Sandbox. These ports allow web servers, APIs, or other services running inside the Vercel Sandbox to be reached externally. Common ports include 3000 (Next.js), 8000 (Python servers), 5000 (Flask), etc.'
        ),
    }),
    execute: async ({ timeout, ports }, { toolCallId }) => {
      writer.write({
        id: toolCallId,
        type: 'data-create-sandbox',
        data: { status: 'loading' },
      })

      try {
        const sandbox = await Sandbox.create({
          timeout: timeout ?? 600000,
          ports,
        })

        writer.write({
          id: toolCallId,
          type: 'data-create-sandbox',
          data: { sandboxId: sandbox.sandboxId, status: 'done' },
        })

        return (
          `Sandbox created with ID: ${sandbox.sandboxId}.` +
          `\nYou can now upload files, run commands, and access services on the exposed ports.`
        )
      } catch (error) {
        const richError = getRichError({
          action: 'Creating Sandbox',
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-create-sandbox',
          data: {
            error: { message: richError.error.message },
            status: 'error',
          },
        })

        console.log('Error creating Sandbox:', richError.error)
        return richError.message
      }
    },
  })
```

file: ai/tools/generate-files.md
```md
Use this tool to generate and upload code files into an existing Vercel Sandbox. It leverages an LLM to create file contents based on the current conversation context and user intent, then writes them directly into the sandbox file system.

The generated files should be considered correct on first iteration and suitable for immediate use in the sandbox environment. This tool is essential for scaffolding applications, adding new features, writing configuration files, or fixing missing components.

All file paths must be relative to the sandbox root (e.g., `src/index.ts`, `package.json`, `components/Button.tsx`).

## When to Use This Tool

Use Generate Files when:

1. You need to create one or more new files as part of a feature, scaffold, or fix
2. The user requests code that implies file creation (e.g., new routes, APIs, components, services)
3. You need to bootstrap a new application structure inside a sandbox
4. You’re completing a multi-step task that involves generating or updating source code
5. A prior command failed due to a missing file, and you need to supply it

## File Generation Guidelines

- Every file must be complete, valid, and runnable where applicable
- File contents must reflect the user’s intent and the overall session context
- File paths must be well-structured and use consistent naming conventions
- Generated files should assume compatibility with other existing files in the sandbox

## Best Practices

- Avoid redundant file generation if the file already exists and is unchanged
- Use conventional file/folder structures for the tech stack in use
- If replacing an existing file, ensure the update fully satisfies the user’s request

## Examples of When to Use This Tool

<example>
User: Add a `NavBar.tsx` component and include it in `App.tsx`
Assistant: I’ll generate the `NavBar.tsx` file and update `App.tsx` to include it.
*Uses Generate Files to create:*
- `components/NavBar.tsx`
- Modified `App.tsx` with import and usage of `NavBar`
</example>

<example>
User: Let’s scaffold a simple Express server with a `/ping` route.
Assistant: I’ll generate the necessary files to start the Express app.
*Uses Generate Files to create:*
- `package.json` with Express as a dependency
- `index.js` with basic server and `/ping` route
</example>

## When NOT to Use This Tool

Avoid using this tool when:

1. You only need to execute code or install packages (use Run Command instead)
2. You’re waiting for a command to finish (use Wait Command)
3. You want to preview a running server or UI (use Get Sandbox URL)
4. You haven’t created a sandbox yet (use Create Sandbox first)

## Output Behavior

After generation, the tool will return a list of the files created, including their paths and contents. These can then be inspected, referenced, or used in subsequent commands.

## Summary

Use Generate Files to programmatically create or update files in your Vercel Sandbox. It enables fast iteration, contextual coding, and dynamic file management — all driven by user intent and conversation context.

```

File: /Users/cameronglynn/reference/examples/apps/vibe-coding-platform/ai/tools/generate-files.ts
```ts
import type { UIMessageStreamWriter, UIMessage } from 'ai'
import type { DataPart } from '../messages/data-parts'
import { Sandbox } from '@vercel/sandbox'
import { getContents, type File } from './generate-files/get-contents'
import { getRichError } from './get-rich-error'
import { getWriteFiles } from './generate-files/get-write-files'
import { tool } from 'ai'
import description from './generate-files.md'
import z from 'zod'

interface Params {
  modelId: string
  writer: UIMessageStreamWriter<UIMessage<never, DataPart>>
}

export const generateFiles = ({ writer, modelId }: Params) =>
  tool({
    description,
    inputSchema: z.object({
      sandboxId: z.string(),
      paths: z.array(z.string()),
    }),
    execute: async ({ sandboxId, paths }, { toolCallId, messages }) => {
      writer.write({
        id: toolCallId,
        type: 'data-generating-files',
        data: { paths: [], status: 'generating' },
      })

      let sandbox: Sandbox | null = null

      try {
        sandbox = await Sandbox.get({ sandboxId })
      } catch (error) {
        const richError = getRichError({
          action: 'get sandbox by id',
          args: { sandboxId },
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-generating-files',
          data: { error: richError.error, paths: [], status: 'error' },
        })

        return richError.message
      }

      const writeFiles = getWriteFiles({ sandbox, toolCallId, writer })
      const iterator = getContents({ messages, modelId, paths })
      const uploaded: File[] = []

      try {
        for await (const chunk of iterator) {
          if (chunk.files.length > 0) {
            const error = await writeFiles(chunk)
            if (error) {
              return error
            } else {
              uploaded.push(...chunk.files)
            }
          } else {
            writer.write({
              id: toolCallId,
              type: 'data-generating-files',
              data: {
                status: 'generating',
                paths: chunk.paths,
              },
            })
          }
        }
      } catch (error) {
        const richError = getRichError({
          action: 'generate file contents',
          args: { modelId, paths },
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-generating-files',
          data: {
            error: richError.error,
            status: 'error',
            paths,
          },
        })

        return richError.message
      }

      writer.write({
        id: toolCallId,
        type: 'data-generating-files',
        data: { paths: uploaded.map((file) => file.path), status: 'done' },
      })

      return `Successfully generated and uploaded ${
        uploaded.length
      } files. Their paths and contents are as follows:
        ${uploaded
          .map((file) => `Path: ${file.path}\nContent: ${file.content}\n`)
          .join('\n')}`
    },
  })
```

file: ai/tools/get-rich-error.ts
```ts
import { APIError } from '@vercel/sandbox/dist/api-client/api-error'

interface Params {
  args?: Record<string, unknown>
  action: string
  error: unknown
}

/**
 * Allows to parse a thrown error to check its metadata and construct a rich
 * message that can be handed to the LLM.
 */
export function getRichError({ action, args, error }: Params) {
  const fields = getErrorFields(error)
  let message = `Error during ${action}: ${fields.message}`
  if (args) message += `\nParameters: ${JSON.stringify(args, null, 2)}`
  if (fields.json) message += `\nJSON: ${JSON.stringify(fields.json, null, 2)}`
  if (fields.text) message += `\nText: ${fields.text}`
  return {
    message: message,
    error: fields,
  }
}

function getErrorFields(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      json: error,
    }
  } else if (error instanceof APIError) {
    return {
      message: error.message,
      json: error.json,
      text: error.text,
    }
  } else {
    return {
      message: error.message,
      json: error,
    }
  }
}
```

file: ai/tools/get-sandbox-url.md
```md
Use this tool to retrieve a publicly accessible URL for a specific port that was exposed during the creation of a Vercel Sandbox. This allows users (and the assistant) to preview web applications, access APIs, or interact with services running inside the sandbox via HTTP.

⚠️ The requested port must have been explicitly declared when the sandbox was created. If the port was not exposed at sandbox creation time, this tool will NOT work for that port.

## When to Use This Tool

Use Get Sandbox URL when:

1. A service or web server is running on a port that was exposed during sandbox creation
2. You need to share a live preview link with the user
3. You want to access a running server inside the sandbox via HTTP
4. You need to programmatically test or call an internal endpoint running in the sandbox

## Critical Requirements

- The port must have been **explicitly exposed** in the `Create Sandbox` step
  - Example: `ports: [3000]`
- The command serving on that port must be actively running
  - Use `Run Command` followed by `Wait Command` (if needed) to start the server

## Best Practices

- Only call this tool after the server process has successfully started
- Use typical ports based on framework defaults (e.g., 3000 for Next.js, 5173 for Vite, 8080 for Node APIs)
- If multiple services run on different ports, ensure each port was exposed up front during sandbox creation
- Don’t attempt to expose or discover ports dynamically after creation — only predefined ports are valid

## When NOT to Use This Tool

Avoid using this tool when:

1. The port was **not declared** during sandbox creation — it will not be accessible
2. No server is running on the specified port
3. You haven't started the service yet or haven't waited for it to boot up
4. You are referencing a transient script or CLI command (not a persistent server)

## Example

<example>
User: Can I preview the app after it's built?
Assistant:
1. Create Sandbox: expose port 3000
2. Generate Files: scaffold the app
3. Run Command: `npm run dev`
4. (Optional) Wait Command
5. Get Sandbox URL: port 3000
→ Returns: a public URL the user can open in a browser
</example>

## Summary

Use Get Sandbox URL to access live previews of services running inside the sandbox — but only for ports that were explicitly exposed during sandbox creation. If the port wasn’t declared, it will not be accessible externally.
```

file: ai/tools/get-sandbox-url.ts
```ts
import type { UIMessageStreamWriter, UIMessage } from 'ai'
import type { DataPart } from '../messages/data-parts'
import { Sandbox } from '@vercel/sandbox'
import { tool } from 'ai'
import description from './get-sandbox-url.md'
import z from 'zod'

interface Params {
  writer: UIMessageStreamWriter<UIMessage<never, DataPart>>
}

export const getSandboxURL = ({ writer }: Params) =>
  tool({
    description,
    inputSchema: z.object({
      sandboxId: z
        .string()
        .describe(
          "The unique identifier of the Vercel Sandbox (e.g., 'sbx_abc123xyz'). This ID is returned when creating a Vercel Sandbox and is used to reference the specific sandbox instance."
        ),
      port: z
        .number()
        .describe(
          'The port number where a service is running inside the Vercel Sandbox (e.g., 3000 for Next.js dev server, 8000 for Python apps, 5000 for Flask). The port must have been exposed when the sandbox was created or when running commands.'
        ),
    }),
    execute: async ({ sandboxId, port }, { toolCallId }) => {
      writer.write({
        id: toolCallId,
        type: 'data-get-sandbox-url',
        data: { status: 'loading' },
      })

      const sandbox = await Sandbox.get({ sandboxId })
      const url = sandbox.domain(port)

      writer.write({
        id: toolCallId,
        type: 'data-get-sandbox-url',
        data: { url, status: 'done' },
      })

      return { url }
    },
  })
```

file: ai/tools/run-command.md
```md
Use this tool to run a command inside an existing Vercel Sandbox. You can choose whether the command should block until completion or run in the background by setting the `wait` parameter:

- `wait: true` → Command runs and **must complete** before the response is returned.
- `wait: false` → Command starts in the background, and the response returns immediately with its `commandId`.

⚠️ Commands are stateless — each one runs in a fresh shell session with **no memory** of previous commands. You CANNOT rely on `cd`, but other state like shell exports or background processes from prior commands should be available.

## When to Use This Tool

Use Run Command when:

1. You need to install dependencies (e.g., `pnpm install`)
2. You want to run a build or test process (e.g., `pnpm build`, `vite build`)
3. You need to launch a development server or long-running process
4. You need to compile or execute code within the sandbox
5. You want to run a task in the background without blocking the session

## Sequencing Rules

- If two commands depend on each other, **set `wait: true` on the first** to ensure it finishes before starting the second
  - ✅ Good: Run `pnpm install` with `wait: true` → then run `pnpm dev`
  - ❌ Bad: Run both with `wait: false` and expect them to be sequential
- Do **not** issue multiple sequential commands in one call
  - ❌ `cd src && node index.js`
  - ✅ `node src/index.js`
- Do **not** assume directory state is preserved — use full relative paths

## Command Format

- Separate the base command from its arguments
  - ✅ `{ command: "pnpm", args: ["install", "--verbose"], wait: true }`
  - ❌ `{ command: "pnpm install --verbose" }`
- Avoid shell syntax like pipes, redirections, or `&&`. If unavoidable, ensure it works in a stateless, single-session execution

## When to Set `wait` to True

- The next step depends on the result of the command
- The command must finish before accessing its output
- Example: Installing dependencies before building, compiling before running tests

## When to Set `wait` to False

- The command is intended to stay running indefinitely (e.g., a dev server)
- The command has no impact on subsequent operations (e.g., printing logs)

## Other Rules

- When running `pnpm dev` in a Next.js or Vite project, HMR can handle updates so generally you don't need to kill the server process and start it again after changing files.

## Examples

<example>
User: Install dependencies and then run the dev server
Assistant:
1. Run Command: `{ command: "pnpm", args: ["install"], wait: true }`
2. Run Command: `{ command: "pnpm", args: ["run", "dev"], wait: false }`
</example>

<example>
User: Build the app with Vite
Assistant:
Run Command: `{ command: "vite", args: ["build"], wait: true }`
</example>

## Summary

Use Run Command to start shell commands in the sandbox, controlling execution flow with the `wait` flag. Commands are stateless and isolated — use relative paths, and only run long-lived processes with `wait: false`.
```

file: ai/tools/run-command.ts
```ts
import type { UIMessageStreamWriter, UIMessage } from 'ai'
import type { DataPart } from '../messages/data-parts'
import { Command, Sandbox } from '@vercel/sandbox'
import { getRichError } from './get-rich-error'
import { tool } from 'ai'
import description from './run-command.md'
import z from 'zod'

interface Params {
  writer: UIMessageStreamWriter<UIMessage<never, DataPart>>
}

export const runCommand = ({ writer }: Params) =>
  tool({
    description,
    inputSchema: z.object({
      sandboxId: z
        .string()
        .describe('The ID of the Vercel Sandbox to run the command in'),
      command: z
        .string()
        .describe(
          "The base command to run (e.g., 'npm', 'node', 'python', 'ls', 'cat'). Do NOT include arguments here. IMPORTANT: Each command runs independently in a fresh shell session - there is no persistent state between commands. You cannot use 'cd' to change directories for subsequent commands."
        ),
      args: z
        .array(z.string())
        .optional()
        .describe(
          "Array of arguments for the command. Each argument should be a separate string (e.g., ['install', '--verbose'] for npm install --verbose, or ['src/index.js'] to run a file, or ['-la', './src'] to list files). IMPORTANT: Use relative paths (e.g., 'src/file.js') or absolute paths instead of trying to change directories with 'cd' first, since each command runs in a fresh shell session."
        ),
      sudo: z
        .boolean()
        .optional()
        .describe('Whether to run the command with sudo'),
      wait: z
        .boolean()
        .describe(
          'Whether to wait for the command to finish before returning. If true, the command will block until it completes, and you will receive its output.'
        ),
    }),
    execute: async (
      { sandboxId, command, sudo, wait, args = [] },
      { toolCallId }
    ) => {
      writer.write({
        id: toolCallId,
        type: 'data-run-command',
        data: { sandboxId, command, args, status: 'executing' },
      })

      let sandbox: Sandbox | null = null

      try {
        sandbox = await Sandbox.get({ sandboxId })
      } catch (error) {
        const richError = getRichError({
          action: 'get sandbox by id',
          args: { sandboxId },
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-run-command',
          data: {
            sandboxId,
            command,
            args,
            error: richError.error,
            status: 'error',
          },
        })

        return richError.message
      }

      let cmd: Command | null = null

      try {
        cmd = await sandbox.runCommand({
          detached: true,
          cmd: command,
          args,
          sudo,
        })
      } catch (error) {
        const richError = getRichError({
          action: 'run command in sandbox',
          args: { sandboxId },
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-run-command',
          data: {
            sandboxId,
            command,
            args,
            error: richError.error,
            status: 'error',
          },
        })

        return richError.message
      }

      writer.write({
        id: toolCallId,
        type: 'data-run-command',
        data: {
          sandboxId,
          commandId: cmd.cmdId,
          command,
          args,
          status: 'executing',
        },
      })

      if (!wait) {
        writer.write({
          id: toolCallId,
          type: 'data-run-command',
          data: {
            sandboxId,
            commandId: cmd.cmdId,
            command,
            args,
            status: 'running',
          },
        })

        return `The command \`${command} ${args.join(
          ' '
        )}\` has been started in the background in the sandbox with ID \`${sandboxId}\` with the commandId ${
          cmd.cmdId
        }.`
      }

      writer.write({
        id: toolCallId,
        type: 'data-run-command',
        data: {
          sandboxId,
          commandId: cmd.cmdId,
          command,
          args,
          status: 'waiting',
        },
      })

      const done = await cmd.wait()
      try {
        const [stdout, stderr] = await Promise.all([
          done.stdout(),
          done.stderr(),
        ])

        writer.write({
          id: toolCallId,
          type: 'data-run-command',
          data: {
            sandboxId,
            commandId: cmd.cmdId,
            command,
            args,
            exitCode: done.exitCode,
            status: 'done',
          },
        })

        return (
          `The command \`${command} ${args.join(
            ' '
          )}\` has finished with exit code ${done.exitCode}.` +
          `Stdout of the command was: \n` +
          `\`\`\`\n${stdout}\n\`\`\`\n` +
          `Stderr of the command was: \n` +
          `\`\`\`\n${stderr}\n\`\`\``
        )
      } catch (error) {
        const richError = getRichError({
          action: 'wait for command to finish',
          args: { sandboxId, commandId: cmd.cmdId },
          error,
        })

        writer.write({
          id: toolCallId,
          type: 'data-run-command',
          data: {
            sandboxId,
            commandId: cmd.cmdId,
            command,
            args,
            error: richError.error,
            status: 'error',
          },
        })

        return richError.message
      }
    },
  })
```
