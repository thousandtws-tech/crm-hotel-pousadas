"""SSH helper para o SRV-PROD-01 (192.168.1.16). Envia comandos PowerShell via base64."""
import base64
import sys

import paramiko

HOST, PORT, USER, PASSWORD = "192.168.1.16", 22, "admin", "65301527"


def run(cmds):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=10)
    for cmd in cmds:
        b64 = base64.b64encode(cmd.encode("utf-16-le")).decode()
        _, out, err = c.exec_command(
            f"powershell -NoProfile -EncodedCommand {b64}", timeout=60
        )
        print(f"=== {cmd[:80]}")
        print(out.read().decode("utf-8", "replace").strip() or "(vazio)")
        e = err.read().decode("utf-8", "replace").strip()
        if e:
            print("ERR:", e[:400])
    c.close()


if __name__ == "__main__":
    run(sys.argv[1:] or ["hostname"])
