use std::{
    env,
    error::Error,
    io::{self, Write},
    path::PathBuf,
};

use clap::Parser;
use rust_agent::{provider::OpenAiCompatibleProvider, runtime::AgentRuntime};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(version, about = "Local-first Rust Agent")]
struct Args {
    /// Workspace accessible to file tools.
    #[arg(long, default_value = ".")]
    workspace: PathBuf,

    /// OpenAI-compatible API base URL (the /chat/completions suffix is added).
    #[arg(long, default_value = "https://api.openai.com/v1")]
    base_url: String,

    /// Model identifier required by the configured provider.
    #[arg(long)]
    model: String,

    /// Environment variable containing the API key.
    #[arg(long, default_value = "OPENAI_API_KEY")]
    api_key_env: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .init();

    let args = Args::parse();
    let workspace = args.workspace.canonicalize()?;
    if !workspace.is_dir() {
        return Err(format!("workspace is not a directory: {}", workspace.display()).into());
    }

    let api_key = env::var(&args.api_key_env).map_err(|_| {
        format!("missing API key: set environment variable {}", args.api_key_env)
    })?;

    let provider = OpenAiCompatibleProvider::new(args.base_url, args.model, api_key)?;
    let mut runtime = AgentRuntime::new(provider, workspace);

    println!("Rust Agent ready. Workspace: {}", runtime.workspace().display());
    println!("Enter a request; type /exit to quit.");

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

        match runtime.run_turn(input).await {
            Ok(answer) => println!("agent> {answer}"),
            Err(error) => eprintln!("error> {error}"),
        }
    }

    Ok(())
}
