' AI Health Cam — ตัวเปิดแอปแบบเงียบ (ไม่มีหน้าต่าง console)
'
' รันผ่าน pyw.exe / Python 3.14 ซึ่ง "มีลายเซ็นดิจิทัล" ที่ Smart App Control
' เชื่อถือ จึงไม่โดนบล็อกเหมือนไฟล์ .exe ที่ build เองและยังไม่ได้ sign
'
' วิธีใช้: ดับเบิลคลิกไฟล์นี้ได้เลย
Dim fso, sh, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' หน้าต่างสไตล์ 0 = ซ่อน, False = ไม่รอให้จบ
sh.Run "pyw -3.14 """ & here & "\health_cam.py""", 0, False
