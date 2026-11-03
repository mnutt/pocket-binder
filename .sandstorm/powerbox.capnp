@0xaba5c5fa8df2ca17;
using Api = import "/sandstorm/api-session.capnp";
# Wire-compatible specialization of PowerboxDescriptor for the HTTP driver.
struct HttpDescriptor {
  tags @0 :List(Tag);
  struct Tag {
    id @0 :UInt64;
    value @1 :Api.ApiSession.PowerboxTag;
  }
}
