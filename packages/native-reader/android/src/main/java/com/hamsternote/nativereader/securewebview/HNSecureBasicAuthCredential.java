package com.hamsternote.nativereader.securewebview;

class HNSecureBasicAuthCredential {
    String username;
    String password;

    HNSecureBasicAuthCredential(String username, String password) {
        this.username = username;
        this.password = password;
    }
}