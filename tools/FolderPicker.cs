using System;
using System.IO;
using System.Runtime.InteropServices;

// Windows Common Item Dialog, in folder mode. Only the selected path leaves this process.
// https://learn.microsoft.com/windows/win32/shell/common-file-dialog
public static class KaraokeFolderPicker
{
    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);

    public static string Choose(IntPtr owner, string initialPath, string title, string confirmLabel)
    {
        var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("dc1c5a9c-e88a-4dde-a5a1-60f82a20aef7")));
        IShellItem initial = null, selected = null;
        try
        {
            uint options;
            dialog.GetOptions(out options);
            // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST | NOCHANGEDIR
            dialog.SetOptions(options | 0x20u | 0x40u | 0x800u | 0x8u);
            dialog.SetTitle(title);
            dialog.SetOkButtonLabel(confirmLabel);
            if (Directory.Exists(initialPath))
            {
                var iid = typeof(IShellItem).GUID;
                SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out initial);
                dialog.SetFolder(initial);
            }
            int result = dialog.Show(owner);
            if (result == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out selected);
            IntPtr path;
            selected.GetDisplayName(0x80058000u, out path); // SIGDN_FILESYSPATH
            try { return Marshal.PtrToStringUni(path); }
            finally { Marshal.FreeCoTaskMem(path); }
        }
        finally
        {
            if (selected != null) Marshal.ReleaseComObject(selected);
            if (initial != null) Marshal.ReleaseComObject(initial);
            Marshal.ReleaseComObject(dialog);
        }
    }
}
