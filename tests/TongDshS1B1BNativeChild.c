#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>
#include <stdio.h>

/* Immutable, local no-model Windows ACL probe.
   Every path is constructed from a single generated test directory.
   No shell, network, plugin, DSH, or arbitrary executable arguments. */
static int file_readable(const wchar_t *path, DWORD *error) {
    HANDLE h=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,
                         FILE_ATTRIBUTE_NORMAL,NULL);
    if(h==INVALID_HANDLE_VALUE) {*error=GetLastError();return 0;}
    CloseHandle(h);
    *error=0;
    return 1;
}
static int write_result(const wchar_t *path,const char bits[4]) {
    HANDLE h=CreateFileW(path,GENERIC_WRITE,0,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    DWORD wrote=0;
    BOOL ok;
    if(h==INVALID_HANDLE_VALUE)return 0;
    ok=WriteFile(h,bits,3,&wrote,NULL);
    CloseHandle(h);
    return ok&&wrote==3;
}
static int join(wchar_t *out,size_t cap,const wchar_t *root,const wchar_t *file) {
    if(swprintf(out,cap,L"%ls\\%ls",root,file)<0)return 0;
    return wcslen(out)<cap-1;
}
int wmain(int argc,wchar_t **argv) {
    wchar_t allowed[1024],privateFile[1024],result[1024];
    HANDLE token=NULL;
    DWORD error=0;
    char bits[4]={'0','0','0','\0'};
    int ok=0;
    if(argc!=3||wcscmp(argv[1],L"--fixed-acl-canary")!=0||
       wcslen(argv[2])>650||!wcsstr(argv[2],L"TongDshS1B1BNative-"))
       return 2;
    if(!join(allowed,1024,argv[2],L"allowed.txt")||
       !join(privateFile,1024,argv[2],L"private.txt")||
       !join(result,1024,argv[2],L"result.txt"))
       return 2;
    if(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token)) {
        if(IsTokenRestricted(token))bits[0]='1';
        CloseHandle(token);
    }
    if(file_readable(allowed,&error))bits[1]='1';
    if(!file_readable(privateFile,&error) && error==ERROR_ACCESS_DENIED)bits[2]='1';
    ok=write_result(result,bits);
    return ok&&bits[0]=='1'&&bits[1]=='1'&&bits[2]=='1'?0:3;
}
