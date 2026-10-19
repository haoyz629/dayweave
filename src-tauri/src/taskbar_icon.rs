use windows_sys::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{CreateIcon, DestroyIcon, HICON, SendMessageW, ICON_BIG, WM_SETICON},
};

// The window borrows this handle, so application state owns it until shutdown.
// Theme changes reuse the same approved light icon.
pub(super) struct TaskbarIcons {
    icon: NativeIcon,
}

struct NativeIcon(isize);

impl NativeIcon {
    fn new(image: &tauri::image::Image<'_>) -> Result<Self, String> {
        let width = image.width() as usize;
        let height = image.height() as usize;
        if width != 128 || height != 128 || image.rgba().len() != width * height * 4 {
            return Err("任务栏图标数据无效".into());
        }
        let mut bgra = image.rgba().to_vec();
        let mut mask = vec![0u8; width * height / 8];
        for (index, pixel) in bgra.chunks_exact_mut(4).enumerate() {
            pixel.swap(0, 2);
            if pixel[3] == 0 {
                mask[index / 8] |= 0x80 >> (index % 8);
            }
        }
        // Buffers have the validated dimensions and remain alive for this copying API.
        let handle = unsafe {
            CreateIcon(std::ptr::null_mut(), width as i32, height as i32, 1, 32,
                mask.as_ptr(), bgra.as_ptr())
        };
        if handle.is_null() {
            return Err(format!("无法创建任务栏图标：{}", std::io::Error::last_os_error()));
        }
        Ok(Self(handle as isize))
    }
}

impl Drop for NativeIcon {
    fn drop(&mut self) {
        // This is exclusively owned, not a shared resource or a handle returned by WM_SETICON.
        unsafe { DestroyIcon(self.0 as HICON); }
    }
}

impl TaskbarIcons {
    pub(super) fn new() -> Result<Self, String> {
        Ok(Self {
            icon: NativeIcon::new(&super::app_logo("light")?)?,
        })
    }

    // Called on the window's UI thread with a live HWND and a validated mode.
    pub(super) fn set_for_window(&self, hwnd: isize, _mode: &str) {
        unsafe { SendMessageW(hwnd as HWND, WM_SETICON, ICON_BIG as usize, self.icon.0); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, ICON_SMALL, WM_GETICON, WS_POPUP,
    };

    #[test]
    fn taskbar_uses_one_light_big_icon_across_repeated_theme_changes() {
        let icons = TaskbarIcons::new().unwrap();
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let hwnd = unsafe {
            CreateWindowExW(0, class.as_ptr(), class.as_ptr(), WS_POPUP, 0, 0, 128, 128,
                std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null())
        };
        assert!(!hwnd.is_null(), "{}", std::io::Error::last_os_error());
        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
        }
        let window = TestWindow(hwnd);
        unsafe { SendMessageW(window.0, WM_SETICON, ICON_SMALL as usize, icons.icon.0); }
        for mode in ["light", "dark", "light", "dark", "light"] {
            icons.set_for_window(window.0 as isize, mode);
            let actual = unsafe { SendMessageW(window.0, WM_GETICON, ICON_BIG as usize, 0) };
            assert_eq!(actual, icons.icon.0);
            assert_eq!(unsafe { SendMessageW(window.0, WM_GETICON, ICON_SMALL as usize, 0) },
                icons.icon.0, "taskbar updates must not replace Tauri's small icon");
        }
    }
}
