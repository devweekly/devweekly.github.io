use std::{
    env,
    error::Error,
    io::{self, Write},
    path::PathBuf,
};

use rust_agent::{provider::OpenAiCompatibleProvider, runtime::AgentRuntime};
use tracing_subscriber::EnvFilter;

struct Args {
    workspace: PathBuf,
    base_url: String,
    model: String,
    api_key_env: String,
}

impl Args {
    fn parse() -> Result<Option<Self>, Box<dyn Error>> {
        let mut args = env::args().skip(1);
        let mut parsed = Self {
            workspace: PathBuf::from("."),
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            api_key_env: "OPENAI_API_KEY".into(),
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

            let value = match inline_value {
                Some(value) => value,
                None => args.next().ok_or_else(|| format!("missing value for {name}"))?,
            };

            match name.as_str() {
                "--workspace" => parsed.workspace = PathBuf::from(value),
                "--base-url" => parsed.base_url = value,
                "--model" => parsed.model = value,
                "--api-key-env" => parsed.api_key_env = value,
                _ => return Err(format!("unknown argument: {name}").into()),
            }
        }

        if parsed.model.trim().is_empty() {
            return Err("missing required argument: --model".into());
        }

        Ok(Some(parsed))
    }

    fn print_help() {
        println!(
            "Local-first Rust Agent\n\n\
             Usage: rust-agent --model <MODEL> [OPTIONS]\n\n\
             Options:\n\
             --workspace <PATH>       Workspace accessible to file tools [default: .]\n\
             --base-url <URL>         OpenAI-compatible API base URL [default: https://api.openai.com/v1]\n\
             --model <MODEL>          Model identifier (required)\n\
             --api-key-env <NAME>     Environment variable containing the API key [default: OPENAI_API_KEY]\n\
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
