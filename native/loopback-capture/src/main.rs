//! Captures the audio rendered by one process (and its child process tree) via the
//! Windows 10 2004+ (build 19041+) WASAPI "process loopback" API, and writes raw 32-bit float PCM
//! (48 kHz, stereo) to stdout for ffmpeg to consume via `-f f32le -i pipe:0`.
//!
//! Usage: loopback-capture --pid <PID>

use std::collections::VecDeque;
use std::error::Error;
use std::io::{self, Write};

use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat};
use windows::core::w;
use windows::Win32::System::Threading::{
    AvSetMmThreadCharacteristicsW, GetCurrentProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS
};

type Res<T> = Result<T, Box<dyn Error>>;

/// Frames captured per stdout write. ~85ms at 48kHz — small enough for low latency,
/// large enough to avoid a syscall per WASAPI packet.
const CHUNK_FRAMES: usize = 4096;

/// WASAPI circular buffer size (100ns units). We're recording to a file, not
/// monitoring live, so latency is irrelevant — a generous buffer just gives this
/// process more slack to be scheduled late under system load without dropping
/// samples, which is what causes audible clicks/stutters in the output.
const BUFFER_DURATION_HNS: i64 = 5_000_000; // 500ms

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let pid = match parse_pid(&args) {
        Some(pid) => pid,
        None => {
            eprintln!("usage: loopback-capture --pid <PID>");
            std::process::exit(2);
        }
    };

    if let Err(err) = capture(pid) {
        eprintln!("loopback-capture: {err}");
        std::process::exit(1);
    }
}

fn parse_pid(args: &[String]) -> Option<u32> {
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        if arg == "--pid" {
            return it.next().and_then(|v| v.parse::<u32>().ok());
        }
    }
    None
}

fn capture(pid: u32) -> Res<()> {
    // COM must be initialized on this thread before any WASAPI call.
    initialize_mta().ok().unwrap();

    // Best-effort hardening against being starved of CPU time by other processes,
    // which is what causes audible clicks/dropouts: a delayed GetBuffer/ReleaseBuffer
    // call means WASAPI's circular buffer overruns before we've drained it. MMCSS is
    // the OS-sanctioned mechanism for this — it's what WASAPI itself recommends for
    // any thread servicing an audio stream — plus a modest process priority bump.
    // Both are advisory; failure here must not stop capture from proceeding.
    unsafe {
        let _ = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
        let mut mmcss_task_index: u32 = 0;
        let _ = AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut mmcss_task_index);
    }

    let desired_format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let blockalign = desired_format.get_blockalign();

    // Capture the whole process tree so child/renderer processes (e.g. browser tabs)
    // playing audio on behalf of the target app are included.
    let include_tree = true;
    let mut audio_client = AudioClient::new_application_loopback_client(pid, include_tree)?;

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: BUFFER_DURATION_HNS,
    };
    audio_client.initialize_client(&desired_format, &Direction::Capture, &mode)?;

    let h_event = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;

    let mut sample_queue: VecDeque<u8> = VecDeque::new();
    audio_client.start_stream()?;

    let stdout = io::stdout();
    let mut out = stdout.lock();
    let chunk_bytes = blockalign as usize * CHUNK_FRAMES;

    // No graceful-shutdown handling: the Node parent process force-terminates this
    // helper when recording stops, the same way it already handles ffmpeg's fast-stop
    // path. Termination closes stdout, which EOFs ffmpeg's stdin pipe and lets ffmpeg
    // finalize the file on its own.
    loop {
        while sample_queue.len() >= chunk_bytes {
            let chunk: Vec<u8> = sample_queue.drain(..chunk_bytes).collect();
            if out.write_all(&chunk).is_err() || out.flush().is_err() {
                // ffmpeg's stdin pipe closed — recording has already stopped.
                return Ok(());
            }
        }

        let new_frames = capture_client.get_next_packet_size()?.unwrap_or(0);
        if new_frames > 0 {
            capture_client.read_from_device_to_deque(&mut sample_queue)?;
        }

        if h_event.wait_for_event(3000).is_err() {
            eprintln!("loopback-capture: capture event timeout — target process likely exited");
            audio_client.stop_stream().ok();
            return Ok(());
        }
    }
}
