#[test]
fn logo_modes_use_the_same_valid_light_rgba_asset() {
    let light = super::app_logo("light").unwrap();
    let dark = super::app_logo("dark").unwrap();
    for icon in [&light, &dark] {
        assert_eq!((icon.width(), icon.height()), (128, 128));
        assert_eq!(icon.rgba().len(), 128 * 128 * 4);
        assert_eq!(icon.rgba()[3], 0, "SVG canvas keeps its transparent background");
        assert!(icon.rgba().chunks_exact(4).any(|pixel| pixel[3] == 255));
        assert!(icon.rgba().chunks_exact(4).any(|pixel| pixel[3] > 0 && pixel[3] < 255));
    }
    assert_eq!(light.rgba(), dark.rgba(), "all themes use the approved light logo");
    assert!(super::app_logo("unknown").is_err());
}

#[test]
fn tray_uses_a_fine_frame_and_solid_dw_with_transparent_outer_corners() {
    let icon = super::tray_logo();
    assert_eq!((icon.width(), icon.height()), (32, 32));
    assert_eq!(icon.rgba().len(), 32 * 32 * 4);
    assert_eq!(icon.rgba()[3], 0);
    let pixels: Vec<_> = icon.rgba().chunks_exact(4).collect();
    assert!(pixels.iter().any(|pixel| pixel[3] == 255));
    assert!(pixels.iter().any(|pixel| pixel[3] > 0 && pixel[3] < 255));
    let pixel = |x: usize, y: usize| &icon.rgba()[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
    for (x, y) in [(0, 0), (31, 0), (0, 31), (31, 31)] {
        assert_eq!(pixel(x, y)[3], 0, "outside rounded frame stays transparent");
    }
    assert_eq!(pixel(4, 16), [232, 234, 237, 255], "opaque gray background separates frame from D/W");
    assert_eq!(pixel(9, 16), [38, 40, 37, 255], "D/W uses solid brand ink");
    assert!(pixel(1, 16)[3] > 0 && pixel(1, 16)[0] < 120, "fine frame remains visible");
}
