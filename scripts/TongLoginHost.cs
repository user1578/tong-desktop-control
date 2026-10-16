using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// /target:winexe prevents a console for the host itself. CreateNoWindow with
// UseShellExecute=false prevents one for the unchanged, pinned PS5.1 runner.
internal static class TongLoginHost
{
    [STAThread]
    private static int Main()
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            string runner = Path.Combine(directory, "TongLoginRuntime.ps1");
            if (!File.Exists(runner)) throw new FileNotFoundException("Login runner missing");
            using (var stdout = new StreamWriter(Path.Combine(directory, "host.stdout.log"), true, new UTF8Encoding(false)))
            using (var stderr = new StreamWriter(Path.Combine(directory, "host.stderr.log"), true, new UTF8Encoding(false)))
            using (var process = new Process())
            {
                stdout.AutoFlush = true;
                stderr.AutoFlush = true;
                process.StartInfo = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoLogo -NoProfile -NonInteractive -File \"" + runner + "\" -Mode run",
                    WorkingDirectory = Directory.GetParent(directory.TrimEnd(Path.DirectorySeparatorChar)).FullName,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    RedirectStandardInput = true
                };
                process.OutputDataReceived += (sender, e) => { if (e.Data != null) stdout.WriteLine(e.Data); };
                process.ErrorDataReceived += (sender, e) => { if (e.Data != null) stderr.WriteLine(e.Data); };
                process.Start();
                process.StandardInput.Close();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                // Parameterless WaitForExit also drains asynchronous output.
                // The task remains Running and sees the runner's failure code.
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(Path.Combine(directory, "host.failure.log"), DateTime.UtcNow.ToString("o") + " " + error.GetType().Name + ": " + error.Message + Environment.NewLine); }
            catch { /* A nonzero task result is still mandatory if logging fails. */ }
            return 1;
        }
    }
}
