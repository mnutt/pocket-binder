@0xddc2be7590158839;

using Spk = import "/sandstorm/package.capnp";

const pkgdef :Spk.PackageDefinition = (
  id = "7mmxz5rgt5wsra30wmdss86durxddnztkjgpft84y5jxcd1gf8u0",
  manifest = (
    appTitle = (defaultText = "Pocket Binder"),
    appVersion = 32,
    appMarketingVersion = (defaultText = "0.3.29"),
    actions = [(nounPhrase = (defaultText = "card collection"),
      description = (defaultText = "Create a collection with its own cards, decks, and trade history."),
      command = .command)],
    continueCommand = .command,
    metadata = (
      shortDescription = (defaultText = "Card collection manager"),
      description = (defaultText = embed "assets/description.md"),
      changeLog = (defaultText = embed "assets/changelog.md"),
      icons = (
        appGrid = (png = (dpi1x = embed "assets/pocket-binder-128.png", dpi2x = embed "assets/pocket-binder-256.png")),
        grain = (png = (dpi1x = embed "assets/pocket-binder-small-24.png", dpi2x = embed "assets/pocket-binder-small-48.png")),
        market = (png = (dpi1x = embed "assets/pocket-binder-150.png", dpi2x = embed "assets/pocket-binder-300.png")),
        marketBig = (png = (dpi1x = embed "assets/pocket-binder-300.png", dpi2x = embed "assets/pocket-binder-600.png"))
      ),
      screenshots = [
        (width = 1280, height = 837, jpeg = embed "assets/screenshot-1.jpg"),
        (width = 1280, height = 831, jpeg = embed "assets/screenshot-2.jpg")
      ],
      categories = [games],
      author = (contactEmail = "michael@nutt.im", pgpSignature = embed "assets/author-signed-statement.pgp"),
      pgpKeyring = embed "assets/author-keyring.pgp",
      license = (openSource = mit, notices = (defaultText = embed "../public/fonts/OFL-Oxanium.txt"))
    )
  ),
  sourceMap = (searchPath = [
    (sourcePath = "."),
    (sourcePath = "/", hidePaths = ["home", "proc", "sys", "etc/passwd", "etc/hosts", "etc/host.conf", "etc/nsswitch.conf", "etc/resolv.conf"])
  ]),
  fileList = "sandstorm-files.list",
  alwaysInclude = ["opt/app/LICENSE", "opt/app/app.py", "opt/app/public", "opt/app/.sandstorm/launcher.sh", "usr/lib/python3.13"],
  bridgeConfig = (viewInfo = (
    permissions = [(name = "edit", title = (defaultText = "edit collection"), description = (defaultText = "Import cards and manage decks."))],
    roles = [
      (title = (defaultText = "editor"), permissions = [true], verbPhrase = (defaultText = "can edit")),
      (title = (defaultText = "viewer"), permissions = [false], verbPhrase = (defaultText = "can view"), default = true)
    ]
  ))
);
const command :Spk.Manifest.Command = (
  argv = ["/sandstorm-http-bridge", "8000", "--", "/bin/bash", "/opt/app/.sandstorm/launcher.sh"],
  environ = [(key = "PATH", value = "/usr/local/bin:/usr/bin:/bin"), (key = "SANDSTORM", value = "1"), (key = "PYTHONDONTWRITEBYTECODE", value = "1")]
);
