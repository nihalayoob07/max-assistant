// Turns other apps' sound down while Max listens or talks, then puts each back exactly where it was. Per-app
// session volume (what the Windows Volume Mixer shows), not the master volume, so Max's own voice stays at
// full. Without this the mic heard YouTube/Spotify as speech. The C# below is loaded into main.js's
// long-lived PowerShell (the same one that checks which window is in front).
'use strict';

const CS = `
using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices;
namespace MaxDuck {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int NotImpl1(); int NotImpl2(); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 { int N0(); int N1(); int N2(); int N3(); int N4(); int N5(); int N6(); int N7(); int N8();
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    [PreserveSig] int GetProcessId(out int pid); }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume { [PreserveSig] int SetMasterVolume(float level, ref Guid ctx); [PreserveSig] int GetMasterVolume(out float level); }

  public static class A {
    static readonly Dictionary<string, float> saved = new Dictionary<string, float>();
    static List<KeyValuePair<string, ISimpleAudioVolume>> Sessions() {
      var list = new List<KeyValuePair<string, ISimpleAudioVolume>>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev; if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return list;
      var iid = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        int pid; c.GetProcessId(out pid);
        if (pid == 0) continue;   // system sounds
        string name = ""; try { name = Process.GetProcessById(pid).ProcessName; } catch {}
        if (name == "Max" || name == "electron") {
          // never duck Max's own voice; and put it back to full if anything left it low (it was found at 17%,
          // so Max sounded barely audible while ducking still lowered everything else)
          var g0 = Guid.Empty; ((ISimpleAudioVolume)c).SetMasterVolume(1f, ref g0); continue;
        }
        string id; c.GetSessionInstanceIdentifier(out id);
        list.Add(new KeyValuePair<string, ISimpleAudioVolume>(id, (ISimpleAudioVolume)c));
      }
      return list;
    }
    public static string Duck(float factor) {
      int n = 0; var g = Guid.Empty;
      foreach (var s in Sessions()) {
        if (saved.ContainsKey(s.Key)) continue;
        float v; s.Value.GetMasterVolume(out v);
        saved[s.Key] = v; s.Value.SetMasterVolume(v * factor, ref g); n++;
      }
      return "ducked " + n;
    }
    public static string Restore() {
      int n = 0; var g = Guid.Empty;
      foreach (var s in Sessions()) {
        float v; if (saved.TryGetValue(s.Key, out v)) { s.Value.SetMasterVolume(v, ref g); n++; }
      }
      saved.Clear();
      return "restored " + n;
    }
  }
}`;

// One line PowerShell can run: loads the C# (base64, so no quoting trouble).
const loadLine = `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(CS).toString('base64')}')))`;

module.exports = { loadLine };
