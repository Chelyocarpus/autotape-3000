# resolve-loopback-target.ps1 - Outputs JSON mapping window AppUserModelIDs to PIDs,
# plus the full running-process list, so ProcessResolver.ts can resolve a GSMTC
# sourceAppId to a process for isolated app-loopback capture.
# Usage: powershell -NonInteractive -ExecutionPolicy Bypass -File resolve-loopback-target.ps1
#
# GSMTC's SourceAppUserModelId is not always the app's exe basename — e.g. Chromium
# and Firefox assign each top-level window its own generated AppUserModelID (for
# taskbar/jump-list grouping) that bears no resemblance to the process image name.
# Reading System.AppUserModel.ID directly off each visible window (the same property
# Windows itself surfaces to GSMTC) resolves those cases exactly; the process list is
# kept as a fallback for windowless/background players where no window carries the ID.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class LoopbackTargetProbe {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("shell32.dll")]
    public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, out IPropertyStore ppv);

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PropertyKey pkey);
        int GetValue(ref PropertyKey key, [Out] PropVariant pv);
        int SetValue(ref PropertyKey key, PropVariant pv);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey {
        public Guid fmtid;
        public int pid;
        public PropertyKey(Guid guid, int pid) { fmtid = guid; this.pid = pid; }
    }

    // PKEY_AppUserModel_ID (System.AppUserModel.ID) is a VT_LPWSTR (vt=31) property;
    // only the two fields this script reads are declared.
    [StructLayout(LayoutKind.Explicit)]
    public class PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(PropVariant pvar);
        public void Clear() { PropVariantClear(this); }
        public string GetString() {
            return vt == 31 ? Marshal.PtrToStringUni(pointerValue) : null;
        }
    }

    public class WindowAumid { public uint Pid; public string Aumid; }

    public static List<WindowAumid> Get() {
        var results = new List<WindowAumid>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            try {
                Guid guid = typeof(IPropertyStore).GUID;
                IPropertyStore store;
                if (SHGetPropertyStoreForWindow(hWnd, ref guid, out store) != 0 || store == null) return true;
                var key = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
                var pv = new PropVariant();
                store.GetValue(ref key, pv);
                string aumid = pv.GetString();
                pv.Clear();
                if (!string.IsNullOrEmpty(aumid)) {
                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    results.Add(new WindowAumid { Pid = pid, Aumid = aumid });
                }
            } catch {
                // Some windows (elevated, protected, or mid-teardown) reject the property
                // store query — skip them, they're not useful capture targets anyway.
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }
}
"@

$windows = [LoopbackTargetProbe]::Get() | ForEach-Object { [PSCustomObject]@{ Pid = $_.Pid; Aumid = $_.Aumid } }
$processes = Get-Process | Select-Object Id, ProcessName, MainWindowHandle

[PSCustomObject]@{
    windows   = @($windows)
    processes = @($processes)
} | ConvertTo-Json -Compress -Depth 4
