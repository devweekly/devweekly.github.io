use std::{
    env,
    error::Error,
    io::{self, Write},
    path::PathBuf,
};

use rust_agent::{
    provider::OpenAiCompatibleProvider,
    runtime::{AgentRuntime, CancellationHandle, PermissionMode, RuntimeOptions},
};
use tracing_subscriber::EnvFilter;

struct Args {
    workspace: PathBuf,
    base_url: String,
    model: String,
    fallback_model: Option<String>,
    api_key_env: String,
    session_id: Option<String>,
    continue_session: bool,
    session_dir: Option<PathBuf>,
    audit_file: Option<PathBuf>,
    max_tool_calls: usize,
    max_history_messages: usize,
}

impl Args {
    fn parse() -> Result<Option<Self>, Box<dyn Error>> {
        let mut args = env::args().skip(1);
        let mut parsed = Self {
            workspace: PathBuf::from("."),
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            fallback_model: None,
            api_key_env: "OPENAI_API_KEY".into(),
            session_id: None,
            continue_session: false,
            session_dir: None,
            audit_file: None,
            max_tool_calls: 8,
            max_history_messages: 80,
        };

        while let Some(argument) = args.next() {
            let (name, inline_value) = match argument.split_once('=') {
                Some((name, value)) => (name.to_owned(), Some(value.to_owned())),
                None => (argument, None),
            };

            if name == "--help" || name == "-h" {
                Self::print_help();
                return Ok(None);
            }
            if name == "--version" || name == "-V" {
                println!("rust-agent {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }

            if name == "--continue" {
                if inline_value.is_some() {
                    return Err("--continue does not accept a value".into());
                }
                parsed.continue_session = true;
                continue;
            }

            let value = match inline_value {
                Some(value) => value,
                None => args.next().ok_or_else(|| format!("missing value for {name}"))?,
            };

            match name.as_str() {
                "--workspace" => parsed.workspace = PathBuf::from(value),
                "--base-url" => parsed.base_url = value,
                "--model" => parsed.model = value,
                "--fallback-model" => parsed.fallback_model = Some(value),
                "--api-key-env" => parsed.api_key_env = value,
                "--session-id" => parsed.session_id = Some(value),
                "--session-dir" => parsed.session_dir = Some(PathBuf::from(value)),
                "--audit-file" => parsed.audit_file = Some(PathBuf::from(value)),
                "--max-tool-calls" => parsed.max_tool_calls = value.parse()?,
                "--max-history-messages" => parsed.max_history_messages = value.parse()?,
                _ => return Err(format!("unknown argument: {name}").into()),
            }
        }

        if parsed.model.trim().is_empty() {
            return Err("missing required argument: --model".into());
        }
        if parsed.session_id.is_some() && parsed.continue_session {
            return Err("--session-id and --continue are mutually exclusive".into());
        }
        if !(1..=64).contains(&parsed.max_tool_calls) {
            return Err("--max-tool-calls must be between 1 and 64".into());
        }
        if !(4..=2_000).contains(&parsed.max_history_messages) {
            return Err("--max-history-messages must be between 4 and 2000".into());
        }

        Ok(Some(parsed))
    }

    fn print_help() {
        println!(
            "Local-first Rust Agent\n\n\
             Usage: rust-agent --model <MODEL> [OPTIONS]\n\n\
             Provider:\n\
             --base-url <URL>         OpenAI-compatible API base URL [default: https://api.openai.com/v1]\n\
             --model <MODEL>          Model identifier (required)\n\
             --api-key-env <NAME>     Environment variable containing API key [default: OPENAI_API_KEY]\n\
             Workspace:\n\
             --workspace <PATH>       Workspace accessible to file tools [default: .]\n\
             Session:\n\
             --session-id <ID>        Resume an existing session\n\
             --continue               Resume the most recently used session\n\
             --session-dir <PATH>     Session storage directory [default: <workspace>/.rust-agent/sessions]\n\
             --audit-file <PATH>      Append lifecycle and policy events as JSONL\n\
             --max-tool-calls <N>     Maximum tool calls per turn [default: 8]\n\
             --max-history-messages <N> Retained non-system messages [default: 80]\n\
             -h, --help               Print help\n\
             -V, --version            Print version"
        );
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .init();

    let Some(args) = Args::parse()? else {
        return Ok(());
    };
    let workspace = args.workspace.canonicalize()?;
    if !workspace.is_dir() {
        return Err(format!("workspace is not a directory: {}", workspace.display()).into());
    }

    let api_key = env::var(&args.api_key_env).map_err(|_| {
        format!("missing API key: set environment variable {}", args.api_key_env)
    })?;

    let provider = OpenAiCompatibleProvider::new_with_fallback(
        args.base_url,
        args.model,
        args.fallback_model,
        api_key,
    )?;
    let options = RuntimeOptions {
        session_dir: args.session_dir,
        session_id: args.session_id,
        continue_session: args.continue_session,
        audit_file: args.audit_file.or_else(|| Some(workspace.join(".rust-agent").join("audit.jsonl"))),
        max_tool_calls_per_turn: args.max_tool_calls,
        max_history_messages: args.max_history_messages,
        system_prompt: None,
        hooks: Vec::new(),
    };
    let mut runtime = AgentRuntime::new(provider, workspace, options)?;

    println!("Rust Agent ready. Workspace: {}", runtime.workspace().display());
    println!("Session: {}", runtime.session_id());
    println!("Commands: /help, /new, /session, /resume <id>, /fork, /model <id>, /models, /mode <default|plan>, /context, /compact, /exit");

    let stdin = io::stdin();
    loop {
        print!("you> ");
        io::stdout().flush()?;

        let mut input = String::new();
        if stdin.read_line(&mut input)? == 0 {
            break;
        }
        let input = input.trim();
        if input.is_empty() {
            continue;
        }
        if input == "/exit" || input == "/quit" {
            break;
        }
        if input == "/help" {
            println!(" /new                 Start a new session");
            println!(" /session             Show the active session ID");
            println!(" /resume <id>         Resume a session");
            println!(" /fork                Fork the current session");
            println!(" /model <id>          Change the active model");
            println!(" /models              List models exposed by the provider");
            println!(" /mode default|plan   Change write permission behavior");
            println!(" /context             Show retained context message count");
            println!(" /compact             Apply the configured sliding-window limit");
            println!(" Ctrl-C               Cancel the current Agent turn");
            println!(" /exit                Exit");
            continue;
        }
        if input == "/new" {
            runtime.start_new_session()?;
            println!("Started session: {}", runtime.session_id());
            continue;
        }
        if input == "/session" {
            println!("Session: {}", runtime.session_id());
            continue;
        }
        if input == "/fork" {
            runtime.fork_session()?;
            println!("Forked session: {}", runtime.session_id());
            continue;
        }
        if let Some(model) = input.strip_prefix("/model ") {
            runtime.set_model(model.trim().to_owned())?;
            println!("Active model: {}", runtime.model());
            continue;
        }
        if input == "/models" {
            match runtime.list_models().await {
                Ok(models) if models.is_empty() => println!("The provider returned no model IDs."),
                Ok(models) => {
                    for model in models {
                        println!(" {model}{}", if model == runtime.model() { "  [active]" } else { "" });
                    }
                }
                Err(error) => eprintln!("Could not list provider models: {error}"),
            }
            continue;
        }
        if let Some(mode) = input.strip_prefix("/mode ") {
            match mode.trim() {
                "default" => runtime.set_permission_mode(PermissionMode::Default),
                "plan" => runtime.set_permission_mode(PermissionMode::Plan),
                _ => {
                    println!("Mode must be 'default' or 'plan'. Writes always require approval in default mode and are blocked in plan mode.");
                    continue;
                }
            }
            println!("Permission mode: {}", mode.trim());
            continue;
        }
        if input == "/context" {
            println!("Retained messages: {}", runtime.context_message_count());
            println!("Session: {}", runtime.session_id());
            println!("Model: {}", runtime.model());
            continue;
        }
        if input == "/compact" {
            let removed = runtime.compact_context()?;
            println!("Removed {removed} older messages; retained {}.", runtime.context_message_count());
            continue;
        }
        if let Some(session_id) = input.strip_prefix("/resume ") {
            runtime.resume_session(session_id.trim())?;
            println!("Resumed session: {}", runtime.session_id());
            continue;
        }

        let cancellation = CancellationHandle::new();
        let mut turn = Box::pin(runtime.run_turn_with_cancellation(input, &cancellation));
        tokio::select! {
            result = &mut turn => match result {
                Ok(answer) => println!("agent> {answer}"),
                Err(error) => eprintln!("error> {error}"),
            },
            signal = tokio::signal::ctrl_c() => {
                match signal {
                    Ok(()) => {
                        cancellation.cancel();
                        eprintln!("\nCancelling current turn...");
                        match turn.await {
                            Ok(answer) => println!("agent> {answer}"),
                            Err(rust_agent::error::AgentError::Cancelled) => {
                                println!("agent> Turn cancelled.");
                            }
                            Err(error) => eprintln!("error> {error}"),
                        }
                    }
                    Err(error) => {
                        eprintln!("Could not listen for Ctrl-C: {error}");
                        match turn.await {
                            Ok(answer) => println!("agent> {answer}"),
                            Err(error) => eprintln!("error> {error}"),
                        }
                    }
                }
            }
        }
    }

    Ok(())
}
