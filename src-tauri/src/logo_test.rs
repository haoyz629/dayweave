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
