fn main() {
    // WINDOWS: sherpa-onnx-c-api links `cargs` but the -shared package does
    // not ship cargs.lib → LNK1181. The release workflow compiles cargs.lib
    // into cargs-lib/ BEFORE the build; here we only add the search path
    // (sherpa-rs-sys already emits the -lcargs). Additive and harmless when
    // the directory does not exist (local non-voice builds).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        println!("cargo:rustc-link-search=native={dir}/cargs-lib");
    }
    tauri_build::build();
}
