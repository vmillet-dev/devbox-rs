//! A closed set of values that crosses the bridge as a TypeScript union.

/// Declares such an enum together with everything one needs here: its `ALL`
/// array, its stored spelling, `Display` and `FromStr`.
///
/// Written by hand, one variant means four edits — five counting the length in
/// `ALL: [Self; 13]`, which is part of the type. The literal given per variant
/// is the **single** spelling: serde, the database column, `Display` and
/// `FromStr` all read it, so they cannot drift apart.
macro_rules! closed_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $(
                $(#[$variant_meta:meta])*
                $variant:ident = $text:literal
            ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(
            Debug,
            Clone,
            Copy,
            Default,
            PartialEq,
            Eq,
            Hash,
            serde::Serialize,
            serde::Deserialize,
            specta::Type,
        )]
        $vis enum $name {
            $(
                $(#[$variant_meta])*
                #[serde(rename = $text)]
                $variant,
            )+
        }

        impl $name {
            pub const ALL: [Self; [$(Self::$variant),+].len()] = [$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        /// The column carries no `CHECK`: a database written by a newer version
        /// may hold a value this one has never heard of, and the caller decides
        /// whether to fall back.
        impl std::str::FromStr for $name {
            type Err = ();

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(()),
                }
            }
        }
    };
}

pub(crate) use closed_enum;
