{
  "targets": [
    {
      "target_name": "word_hint",
      "cflags!": [ "-fno-exceptions", "-O2" ],
      "cflags_cc!": [ "-fno-exceptions", "-O2" ],
      "sources": [ "word_hint0206_4.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    },
    {
      "target_name": "rime_plugin2",
      "cflags!": [ "-fno-exceptions", "-O2" ],
      "cflags_cc!": [ "-fno-exceptions", "-O2" ],
      "sources": [ "rime_plugin/main2.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
      'libraries': [
        '-lrime'
      ]
    }
  ]
}