# Prints the system cursor type (arrow|hand|text) whenever it changes.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class IlfCursor {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  public static IntPtr Current() { var ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(ci); GetCursorInfo(ref ci); return ci.hCursor; }
}
"@
$hand = [IlfCursor]::LoadCursor([IntPtr]::Zero, 32649)
$ibeam = [IlfCursor]::LoadCursor([IntPtr]::Zero, 32513)
$last = ''
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $h = [IlfCursor]::Current()
  $t = if ($h -eq $hand) { 'hand' } elseif ($h -eq $ibeam) { 'text' } else { 'arrow' }
  if ($t -ne $last) { [Console]::Out.WriteLine($t); [Console]::Out.Flush(); $last = $t }
  Start-Sleep -Milliseconds 25
}
