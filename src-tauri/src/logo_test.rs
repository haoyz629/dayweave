#[test]
fn logo_modes_use_distinct_valid_rgba_assets() {
    let light = super::app_logo("light").unwrap();
    let dark = super::app_logo("dark").unwrap();
    for icon in [&light, &dark] {
        assert_eq!((icon.width(), icon.height()), (128, 128));
        assert_eq!(icon.rgba().len(), 128 * 128 * 4);
        assert_eq!(icon.rgba()[3], 0, "rounded corner is transparent");
        assert_eq!(icon.rgba()[(64 * 128 + 64) * 4 + 3], 255);
    }
    assert_ne!(light.rgba(), dark.rgba());
    assert!(super::app_logo("unknown").is_err());
}
