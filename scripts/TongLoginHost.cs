using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// /target:winexe prevents a console for the host itself. CreateNoWindow with
// UseShellExecute=false prevents one for the pinned runner. Use the installed
// PowerShell 7 File entry; its normal execution policy and MOTW checks remain.
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
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"PowerShell\7\pwsh.exe");
            if (!File.Exists(shell)) throw new FileNotFoundException("PowerShell 7 missing");
            using (var stdout = new StreamWriter(Path.Combine(directory, "host.stdout.log"), true, new UTF8Encoding(false)))
            using (var stderr = new StreamWriter(Path.Combine(directory, "host.stderr.log"), true, new UTF8Encoding(false)))
            using (var process = new Process())
            {
                stdout.AutoFlush = true;
                stderr.AutoFlush = true;
                process.StartInfo = new ProcessStartInfo
                {
                    FileName = shell,
                    Arguments = "-NoLogo -NoProfile -NonInteractive -File \"" + runner + "\" -Mode run",
                    WorkingDirectory = Directory.GetParent(directory.TrimEnd(Path.DirectorySeparatorChar)).FullName,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    RedirectStandardInput = true
                };
                // Native Windows PowerShell helpers compile P/Invoke probes.
                // Keep their scratch files in this reviewed deployment, rather
                // than depending on a user-global Temp directory's permissions.
                string temporary = Path.Combine(directory, "temp");
                Directory.CreateDirectory(temporary);
                process.StartInfo.EnvironmentVariables["TEMP"] = temporary;
                process.StartInfo.EnvironmentVariables["TMP"] = temporary;
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
