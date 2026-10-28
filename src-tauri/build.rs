fn main() {
    // The app icon is embedded in the .exe here; without this, changing the icons does not
    // re-run the build script and the old icon stays in the binary.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
