/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! The [`@property`] at-rule.
//!
//! https://drafts.css-houdini.org/css-properties-values-api-1/#at-property-rule

use super::{
    syntax::{Descriptor, ParsedDescriptor},
    value::{AllowComputationallyDependent, SpecifiedValue as SpecifiedRegisteredValue},
};
use crate::custom_properties::{Name as CustomPropertyName, SpecifiedValue};
use crate::error_reporting::ContextualParseError;
use crate::parser::{Parse, ParserContext};
use crate::shared_lock::{SharedRwLockReadGuard, ToCssWithGuard};
use crate::str::CssStringWriter;
use crate::stylesheets::UrlExtraData;
use crate::values::serialize_atom_name;
use cssparser::{
    AtRuleParser, BasicParseErrorKind, CowRcStr, DeclarationParser, ParseErrorKind, Parser,
    ParserInput, QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, SourceLocation,
};
use malloc_size_of::{MallocSizeOf, MallocSizeOfOps};
use selectors::parser::SelectorParseErrorKind;
use servo_arc::Arc;
use std::fmt::{self, Write};
use style_traits::{CssWriter, ParseError, StyleParseErrorKind, ToCss};
use to_shmem::{SharedMemoryBuilder, ToShmem};

/// Parse the block inside a `@property` rule.
///
/// Valid `@property` rules result in a registered custom property, as if `registerProperty()` had
/// been called with equivalent parameters.
pub fn parse_property_block<'i, 't>(
    context: &ParserContext,
    input: &mut Parser<'i, 't>,
    name: PropertyRuleName,
    location: SourceLocation,
) -> Result<PropertyRuleData, ParseError<'i>> {
    let mut rule = PropertyRuleData::empty(name, location);
    let mut parser = PropertyRuleParser {
        context,
        rule: &mut rule,
    };
    let mut iter = RuleBodyParser::new(input, &mut parser);
    while let Some(declaration) = iter.next() {
        if !context.error_reporting_enabled() {
            continue;
        }
        if let Err((error, slice)) = declaration {
            let location = error.location;
            let error = if matches!(
                error.kind,
                ParseErrorKind::Custom(StyleParseErrorKind::PropertySyntaxField(_))
            ) {
                // If the provided string is not a valid syntax string (if it
                // returns failure when consume a syntax definition is called on
                // it), the descriptor is invalid and must be ignored.
                ContextualParseError::UnsupportedValue(slice, error)
            } else {
                // Unknown descriptors are invalid and ignored, but do not
                // invalidate the @property rule.
                ContextualParseError::UnsupportedPropertyDescriptor(slice, error)
            };
            context.log_css_error(location, error);
        }
    }
    if rule.validate_registration(context.url_data).is_err() {
        return Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid));
    }
    Ok(rule)
}

struct PropertyRuleParser<'a, 'b: 'a> {
    context: &'a ParserContext<'b>,
    rule: &'a mut PropertyRuleData,
}

/// Default methods reject all at rules.
impl<'a, 'b, 'i> AtRuleParser<'i> for PropertyRuleParser<'a, 'b> {
    type Prelude = ();
    type AtRule = ();
    type Error = StyleParseErrorKind<'i>;
}

impl<'a, 'b, 'i> QualifiedRuleParser<'i> for PropertyRuleParser<'a, 'b> {
    type Prelude = ();
    type QualifiedRule = ();
    type Error = StyleParseErrorKind<'i>;
}

impl<'a, 'b, 'i> RuleBodyItemParser<'i, (), StyleParseErrorKind<'i>>
    for PropertyRuleParser<'a, 'b>
{
    fn parse_qualified(&self) -> bool {
        false
    }
    fn parse_declarations(&self) -> bool {
        true
    }
}

macro_rules! property_descriptors {
    (
        $( #[$doc: meta] $name: tt $ident: ident: $ty: ty, )*
    ) => {
        /// Data inside a `@property` rule.
        ///
        /// <https://drafts.css-houdini.org/css-properties-values-api-1/#at-property-rule>
        #[derive(Clone, Debug, PartialEq)]
        pub struct PropertyRuleData {
            /// The custom property name.
            pub name: PropertyRuleName,

            $(
                #[$doc]
                pub $ident: Option<$ty>,
            )*

            /// Line and column of the @property rule source code.
            pub source_location: SourceLocation,
        }

        impl PropertyRuleData {
            /// Create an empty property rule
            pub fn empty(name: PropertyRuleName, source_location: SourceLocation) -> Self {
                PropertyRuleData {
                    name,
                    $(
                        $ident: None,
                    )*
                    source_location,
                }
            }

            /// Serialization of declarations in PropertyRuleData
            pub fn decl_to_css(&self, dest: &mut CssStringWriter) -> fmt::Result {
                $(
                    if let Some(ref value) = self.$ident {
                        dest.write_str(concat!($name, ": "))?;
                        value.to_css(&mut CssWriter::new(dest))?;
                        dest.write_str("; ")?;
                    }
                )*
                Ok(())
            }
        }

       impl<'a, 'b, 'i> DeclarationParser<'i> for PropertyRuleParser<'a, 'b> {
           type Declaration = ();
           type Error = StyleParseErrorKind<'i>;

           fn parse_value<'t>(
               &mut self,
               name: CowRcStr<'i>,
               input: &mut Parser<'i, 't>,
            ) -> Result<(), ParseError<'i>> {
                match_ignore_ascii_case! { &*name,
                    $(
                        $name => {
                            // DeclarationParser also calls parse_entirely so we’d normally not need
                            // to, but in this case we do because we set the value as a side effect
                            // rather than returning it.
                            let value = input.parse_entirely(|i| Parse::parse(self.context, i))?;
                            self.rule.$ident = Some(value)
                        },
                    )*
                    _ => return Err(input.new_custom_error(SelectorParseErrorKind::UnexpectedIdent(name.clone()))),
                }
                Ok(())
            }
        }
    }
}

#[cfg(feature = "gecko")]
property_descriptors! {
    /// <https://drafts.css-houdini.org/css-properties-values-api-1/#the-syntax-descriptor>
    "syntax" syntax: ParsedDescriptor,

    /// <https://drafts.css-houdini.org/css-properties-values-api-1/#inherits-descriptor>
    "inherits" inherits: Inherits,

    /// <https://drafts.css-houdini.org/css-properties-values-api-1/#initial-value-descriptor>
    "initial-value" initial_value: InitialValue,
}

/// Errors that can happen when registering a property.
#[allow(missing_docs)]
pub enum PropertyRegistrationError {
    MissingSyntax,
    MissingInherits,
    NoInitialValue,
    InvalidInitialValue,
    InitialValueNotComputationallyIndependent,
}

impl PropertyRuleData {
    /// Measure heap usage.
    #[cfg(feature = "gecko")]
    pub fn size_of(&self, _guard: &SharedRwLockReadGuard, ops: &mut MallocSizeOfOps) -> usize {
        self.name.0.size_of(ops) +
            self.syntax.size_of(ops) +
            self.inherits.size_of(ops) +
            if let Some(ref initial_value) = self.initial_value {
                initial_value.size_of(ops)
            } else {
                0
            }
    }

    /// Performs syntax validation as per the initial value descriptor.
    /// https://drafts.css-houdini.org/css-properties-values-api-1/#initial-value-descriptor
    pub fn validate_initial_value(
        syntax: &Descriptor,
        initial_value: Option<&InitialValue>,
        url_data: &UrlExtraData,
    ) -> Result<(), PropertyRegistrationError> {
        use crate::properties::CSSWideKeyword;
        // If the value of the syntax descriptor is the universal syntax definition, then the
        // initial-value descriptor is optional. If omitted, the initial value of the property is
        // the guaranteed-invalid value.
        if syntax.is_universal() && initial_value.is_none() {
            return Ok(())
        }

        // Otherwise, if the value of the syntax descriptor is not the universal syntax definition,
        // the following conditions must be met for the @property rule to be valid:

        // The initial-value descriptor must be present.
        let Some(initial) = initial_value else {
            return Err(PropertyRegistrationError::NoInitialValue)
        };

        // A value that references the environment or other variables is not computationally
        // independent.
        if initial.has_references() {
            return Err(PropertyRegistrationError::InitialValueNotComputationallyIndependent);
        }

        let mut input = ParserInput::new(initial.css_text());
        let mut input = Parser::new(&mut input);
        input.skip_whitespace();

        // The initial-value cannot include CSS-wide keywords.
        if input.try_parse(CSSWideKeyword::parse).is_ok() {
            return Err(PropertyRegistrationError::InitialValueNotComputationallyIndependent);
        }

        match SpecifiedRegisteredValue::parse(
            &mut input,
            syntax,
            url_data,
            AllowComputationallyDependent::No,
        ) {
            Ok(_) => {},
            Err(_) => return Err(PropertyRegistrationError::InvalidInitialValue),
        }

        Ok(())
    }

    /// Performs relevant rule validity checks.
    fn validate_registration(
        &self,
        url_data: &UrlExtraData,
    ) -> Result<(), PropertyRegistrationError> {
        use self::PropertyRegistrationError::*;

        // https://drafts.css-houdini.org/css-properties-values-api-1/#the-syntax-descriptor:
        //
        //     The syntax descriptor is required for the @property rule to be valid; if it’s
        //     missing, the @property rule is invalid.
        let Some(ref syntax) = self.syntax else { return Err(MissingSyntax) };

        // https://drafts.css-houdini.org/css-properties-values-api-1/#inherits-descriptor:
        //
        //     The inherits descriptor is required for the @property rule to be valid; if it’s
        //     missing, the @property rule is invalid.
        if self.inherits.is_none() { return Err(MissingInherits) };

        Self::validate_initial_value(syntax.descriptor(), self.initial_value.as_ref(), url_data)
    }
}

impl ToCssWithGuard for PropertyRuleData {
    /// <https://drafts.css-houdini.org/css-properties-values-api-1/#serialize-a-csspropertyrule>
    fn to_css(&self, _guard: &SharedRwLockReadGuard, dest: &mut CssStringWriter) -> fmt::Result {
        dest.write_str("@property ")?;
        self.name.to_css(&mut CssWriter::new(dest))?;
        dest.write_str(" { ")?;
        self.decl_to_css(dest)?;
        dest.write_char('}')
    }
}

impl ToShmem for PropertyRuleData {
    fn to_shmem(&self, _builder: &mut SharedMemoryBuilder) -> to_shmem::Result<Self> {
        Err(String::from(
            "ToShmem failed for PropertyRule: cannot handle @property rules",
        ))
    }
}

/// A custom property name wrapper that includes the `--` prefix in its serialization
#[derive(Clone, Debug, PartialEq)]
pub struct PropertyRuleName(pub CustomPropertyName);

impl ToCss for PropertyRuleName {
    fn to_css<W: Write>(&self, dest: &mut CssWriter<W>) -> fmt::Result {
        dest.write_str("--")?;
        serialize_atom_name(&self.0, dest)
    }
}

/// <https://drafts.css-houdini.org/css-properties-values-api-1/#inherits-descriptor>
#[derive(Clone, Debug, MallocSizeOf, Parse, PartialEq, ToCss)]
pub enum Inherits {
    /// `true` value for the `inherits` descriptor
    True,
    /// `false` value for the `inherits` descriptor
    False,
}

/// Specifies the initial value of the custom property registration represented by the @property
/// rule, controlling the property’s initial value.
///
/// The SpecifiedValue is wrapped in an Arc to avoid copying when using it.
pub type InitialValue = Arc<SpecifiedValue>;

impl Parse for InitialValue {
    fn parse<'i, 't>(
        _context: &ParserContext,
        input: &mut Parser<'i, 't>,
    ) -> Result<Self, ParseError<'i>> {
        input.skip_whitespace();
        SpecifiedValue::parse(input)
    }
}
