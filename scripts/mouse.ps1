Add-Type @"
using System; using System.Runtime.InteropServices;
public class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e); }
"@
$pts = @(@(300,300),@(900,250),@(1500,600),@(800,800),@(400,500),@(1200,400))
Start-Sleep -Milliseconds 800
for ($r=0; $r -lt 2; $r++) { for ($k=0; $k -lt $pts.Count-1; $k++) {
  $a=$pts[$k]; $b=$pts[$k+1]
  for ($i=0; $i -le 40; $i++) { $t=$i/40; [M]::SetCursorPos([int]($a[0]+($b[0]-$a[0])*$t), [int]($a[1]+($b[1]-$a[1])*$t)); Start-Sleep -Milliseconds 15 }
  [M]::keybd_event(0x10,0,0,[UIntPtr]::Zero); [M]::keybd_event(0x10,0,2,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300 }
}
