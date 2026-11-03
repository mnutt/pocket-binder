@0xddc2be7590158839;
using Spk = import "/sandstorm/package.capnp";
const pkgdef :Spk.PackageDefinition = (
  id = "7mmxz5rgt5wsra30wmdss86durxddnztkjgpft84y5jxcd1gf8u0",
  manifest = (
    appTitle = (defaultText = "Pocket Binder"),
    appVersion = 2,
    appMarketingVersion = (defaultText = "0.2.1"),
    actions = [(nounPhrase = (defaultText = "card collection"), command = .command)],
    continueCommand = .command,
    metadata = (
      shortDescription = (defaultText = "Pokémon deck builder"),
      categories = [games],
      author = (contactEmail = "michael@nutt.im"),
      license = (none = void)
    )
  ),
  sourceMap = (searchPath = [
    (sourcePath = "."),
    (sourcePath = "/", hidePaths = ["home", "proc", "sys", "etc/passwd", "etc/hosts", "etc/host.conf", "etc/nsswitch.conf", "etc/resolv.conf"])
  ]),
  fileList = "sandstorm-files.list",
  alwaysInclude = ["opt/app/app.py", "opt/app/public", "opt/app/.sandstorm/launcher.sh", "usr/lib/python3.13"],
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
